import pg from 'pg';
import {
  CHUNK_SIZE,
  type AuditEntry,
  type DensityCell,
  type MessageStatus,
  type ReportReason,
  type ReportRecord,
  type ReportStatus,
  type WorldBounds,
  type WorldMessage,
  type WorldPoint,
} from '@canvas/shared-types';
import { runMigrations } from './migrate';
import type {
  RepoStats,
  Repository,
  Reservation,
  SessionRecord,
  StoredMessage,
} from './types';

interface MessageRow {
  id: string;
  session_id: string;
  content: string;
  x: number;
  y: number;
  status: MessageStatus;
  created_at: Date;
}

const iso = (d: Date) => d.toISOString();

function toMessage(r: MessageRow): StoredMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    content: r.content,
    position: { x: r.x, y: r.y },
    status: r.status,
    createdAt: iso(r.created_at),
  };
}

function toPublic(r: MessageRow): WorldMessage {
  const { sessionId: _s, ...pub } = toMessage(r);
  return pub;
}

/**
 * PostgreSQL + PostGIS adapter.
 *
 * Spatial reads use the GiST index through the `&&` bounding-box operator. Position
 * allocation takes transaction-scoped advisory locks on the target chunk and its neighbours
 * (sorted, to avoid deadlocks), so two concurrent allocations that are closer than the
 * minimum distance always serialise. A partial unique index on (x, y) is the final backstop.
 */
export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;

  constructor(
    connectionString: string,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.pool = new pg.Pool({ connectionString, max: 20 });
  }

  async init(): Promise<void> {
    await runMigrations(this.pool, this.log);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  // ----------------------------------------------------------- sessions

  async createSession(s: SessionRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO sessions(id, token_hash, created_at, last_seen_at, blocked) VALUES ($1,$2,$3,$4,$5)',
      [s.id, s.tokenHash, s.createdAt, s.lastSeenAt, s.blocked],
    );
  }

  private toSession(r: {
    id: string;
    token_hash: string;
    created_at: Date;
    last_seen_at: Date;
    blocked: boolean;
  }): SessionRecord {
    return {
      id: r.id,
      tokenHash: r.token_hash,
      createdAt: iso(r.created_at),
      lastSeenAt: iso(r.last_seen_at),
      blocked: r.blocked,
    };
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM sessions WHERE token_hash = $1', [
      tokenHash,
    ]);
    return rows[0] ? this.toSession(rows[0]) : null;
  }

  async findSessionById(id: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows[0] ? this.toSession(rows[0]) : null;
  }

  async touchSession(id: string, at: string): Promise<void> {
    await this.pool.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [id, at]);
  }

  async setSessionBlocked(id: string, blocked: boolean): Promise<boolean> {
    const r = await this.pool.query('UPDATE sessions SET blocked = $2 WHERE id = $1', [id, blocked]);
    return (r.rowCount ?? 0) > 0;
  }

  // ----------------------------------------------------------- positions

  async getReservation(sessionId: string, now: string): Promise<Reservation | null> {
    const { rows } = await this.pool.query(
      'SELECT x, y, expires_at FROM reservations WHERE session_id = $1 AND expires_at > $2',
      [sessionId, now],
    );
    const r = rows[0];
    return r ? { sessionId, position: { x: r.x, y: r.y }, expiresAt: iso(r.expires_at) } : null;
  }

  async tryReserve(
    sessionId: string,
    point: WorldPoint,
    minDistance: number,
    expiresAt: string,
    now: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const radius = Math.max(1, Math.ceil(minDistance / CHUNK_SIZE));
      const cx = Math.floor(point.x / CHUNK_SIZE);
      const cy = Math.floor(point.y / CHUNK_SIZE);
      const keys: string[] = [];
      for (let ix = cx - radius; ix <= cx + radius; ix++) {
        for (let iy = cy - radius; iy <= cy + radius; iy++) keys.push(`chunk:${ix}:${iy}`);
      }
      keys.sort();
      for (const key of keys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      }

      const conflict = await client.query(
        `SELECT 1 FROM messages
          WHERE status <> 'deleted'
            AND location && ST_Expand(ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 0), $3::float8)
            AND ST_Distance(location, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 0)) < $3::float8
          UNION ALL
         SELECT 1 FROM reservations
          WHERE session_id <> $4::uuid AND expires_at > $5::timestamptz
            AND location && ST_Expand(ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 0), $3::float8)
            AND ST_Distance(location, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 0)) < $3::float8
          LIMIT 1`,
        [point.x, point.y, minDistance, sessionId, now],
      );
      if ((conflict.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(
        `INSERT INTO reservations(session_id, x, y, expires_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (session_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, expires_at = EXCLUDED.expires_at`,
        [sessionId, point.x, point.y, expiresAt],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseReservation(sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM reservations WHERE session_id = $1', [sessionId]);
  }

  // ----------------------------------------------------------- messages

  async insertMessageAtReservation(
    input: { id: string; sessionId: string; content: string; createdAt: string },
    now: string,
  ): Promise<WorldMessage | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'SELECT x, y FROM reservations WHERE session_id = $1 AND expires_at > $2 FOR UPDATE',
        [input.sessionId, now],
      );
      const r = res.rows[0];
      if (!r) {
        await client.query('ROLLBACK');
        return null;
      }
      try {
        await client.query(
          'INSERT INTO messages(id, session_id, content, x, y, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [input.id, input.sessionId, input.content, r.x, r.y, input.createdAt],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          await client.query('ROLLBACK');
          return null;
        }
        throw error;
      }
      await client.query('DELETE FROM reservations WHERE session_id = $1', [input.sessionId]);
      await client.query('COMMIT');
      return {
        id: input.id,
        content: input.content,
        position: { x: r.x, y: r.y },
        createdAt: input.createdAt,
        status: 'active',
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async insertMessages(messages: StoredMessage[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Seeded messages need an owner row; one synthetic session owns them.
      for (const sessionId of new Set(messages.map((m) => m.sessionId))) {
        await client.query(
          `INSERT INTO sessions(id, token_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [sessionId, `seed:${sessionId}`],
        );
      }
      for (let i = 0; i < messages.length; i += 500) {
        const slice = messages.slice(i, i + 500);
        const values: unknown[] = [];
        const tuples = slice.map((m, j) => {
          const o = j * 7;
          values.push(m.id, m.sessionId, m.content, m.position.x, m.position.y, m.status, m.createdAt);
          return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7})`;
        });
        await client.query(
          `INSERT INTO messages(id, session_id, content, x, y, status, created_at) VALUES ${tuples.join(',')}
           ON CONFLICT DO NOTHING`,
          values,
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    const { rows } = await this.pool.query<MessageRow>('SELECT * FROM messages WHERE id = $1', [id]);
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async getMessageAt(point: WorldPoint): Promise<WorldMessage | null> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT * FROM messages WHERE x = $1 AND y = $2 AND status = 'active' LIMIT 1`,
      [point.x, point.y],
    );
    return rows[0] ? toPublic(rows[0]) : null;
  }

  async setMessageStatus(id: string, status: MessageStatus): Promise<boolean> {
    const r = await this.pool.query('UPDATE messages SET status = $2 WHERE id = $1', [id, status]);
    return (r.rowCount ?? 0) > 0;
  }

  async queryBounds(b: WorldBounds, limit: number): Promise<WorldMessage[]> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT id, session_id, content, x, y, status, created_at FROM messages
        WHERE status = 'active' AND location && ST_MakeEnvelope($1::float8,$2::float8,$3::float8,$4::float8,0)
        LIMIT $5`,
      [b.minX, b.minY, b.maxX, b.maxY, limit],
    );
    return rows.map(toPublic);
  }

  async density(b: WorldBounds, cellSize: number, maxCells: number): Promise<DensityCell[]> {
    const { rows } = await this.pool.query<{
      cx: number;
      cy: number;
      n: number;
      ax: number;
      ay: number;
    }>(
      `SELECT floor(x::float8 / $5::float8)::int AS cx, floor(y::float8 / $5::float8)::int AS cy,
              count(*)::int AS n, avg(x)::float8 AS ax, avg(y)::float8 AS ay
         FROM messages
        WHERE status = 'active' AND location && ST_MakeEnvelope($1::float8,$2::float8,$3::float8,$4::float8,0)
        GROUP BY 1, 2
        ORDER BY n DESC
        LIMIT $6`,
      [b.minX, b.minY, b.maxX, b.maxY, cellSize, maxCells],
    );
    return rows.map((r) => ({
      cx: r.cx,
      cy: r.cy,
      count: r.n,
      x: Math.round(r.ax),
      y: Math.round(r.ay),
    }));
  }

  async listMessages(status: MessageStatus | undefined, limit: number) {
    const { rows } = await this.pool.query<MessageRow & { report_count: number }>(
      `SELECT m.*, COALESCE(r.n, 0)::int AS report_count
         FROM messages m
         LEFT JOIN (SELECT message_id, count(*) AS n FROM reports GROUP BY 1) r ON r.message_id = m.id
        WHERE ($1::text IS NULL OR m.status = $1)
        ORDER BY report_count DESC, m.created_at DESC
        LIMIT $2`,
      [status ?? null, limit],
    );
    return rows.map((r) => ({ ...toMessage(r), reportCount: r.report_count }));
  }

  async countOccupied(now: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT ((SELECT count(*) FROM messages WHERE status <> 'deleted')
             + (SELECT count(*) FROM reservations WHERE expires_at > $1))::text AS n`,
      [now],
    );
    return Number(rows[0]?.n ?? 0);
  }

  // ----------------------------------------------------------- moderation

  async createReport(r: ReportRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO reports(id, message_id, reason, details, reporter_session_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (message_id, reporter_session_id) DO NOTHING`,
      [r.id, r.messageId, r.reason, r.details ?? null, r.reporterSessionId, r.status, r.createdAt],
    );
  }

  async hasReport(messageId: string, reporterSessionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM reports WHERE message_id = $1 AND reporter_session_id = $2',
      [messageId, reporterSessionId],
    );
    return (rowCount ?? 0) > 0;
  }

  private toReport(r: {
    id: string;
    message_id: string;
    reason: string;
    details: string | null;
    reporter_session_id: string;
    status: ReportStatus;
    created_at: Date;
  }): ReportRecord {
    return {
      id: r.id,
      messageId: r.message_id,
      reason: r.reason as ReportReason,
      ...(r.details ? { details: r.details } : {}),
      reporterSessionId: r.reporter_session_id,
      status: r.status,
      createdAt: iso(r.created_at),
    };
  }

  async listReports(status: ReportStatus | undefined, limit: number): Promise<ReportRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM reports WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`,
      [status ?? null, limit],
    );
    return rows.map((r) => this.toReport(r));
  }

  async updateReportStatus(id: string, status: ReportStatus): Promise<ReportRecord | null> {
    const { rows } = await this.pool.query('UPDATE reports SET status = $2 WHERE id = $1 RETURNING *', [
      id,
      status,
    ]);
    return rows[0] ? this.toReport(rows[0]) : null;
  }

  async addAudit(e: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs(id, actor, action, target_type, target_id, ip, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [e.id, e.actor, e.action, e.targetType, e.targetId, e.ip ?? null, JSON.stringify(e.metadata), e.createdAt],
    );
  }

  async listAudit(limit: number): Promise<AuditEntry[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      ...(r.ip ? { ip: r.ip as string } : {}),
      metadata: r.metadata as Record<string, unknown>,
      createdAt: iso(r.created_at),
    }));
  }

  async stats(now: string): Promise<RepoStats> {
    const { rows } = await this.pool.query<Record<string, number>>(
      `SELECT
         (SELECT count(*) FROM messages)::int AS total,
         (SELECT count(*) FROM messages WHERE status = 'active')::int AS active,
         (SELECT count(*) FROM messages WHERE status = 'hidden')::int AS hidden,
         (SELECT count(*) FROM messages WHERE created_at >= $1::timestamptz - interval '24 hours')::int AS today,
         (SELECT count(*) FROM sessions)::int AS sessions,
         (SELECT count(*) FROM sessions WHERE blocked)::int AS blocked,
         (SELECT count(*) FROM reports WHERE status = 'open')::int AS open_reports`,
      [now],
    );
    const r = rows[0] as Record<string, number>;
    return {
      totalMessages: r.total ?? 0,
      activeMessages: r.active ?? 0,
      hiddenMessages: r.hidden ?? 0,
      messagesToday: r.today ?? 0,
      totalSessions: r.sessions ?? 0,
      blockedSessions: r.blocked ?? 0,
      openReports: r.open_reports ?? 0,
    };
  }
}
