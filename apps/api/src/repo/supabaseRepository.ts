import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AuditEntry,
  DensityCell,
  MessageStatus,
  ReportRecord,
  ReportStatus,
  WorldBounds,
  WorldMessage,
  WorldPoint,
} from '@canvas/shared-types';
import type {
  RepoStats,
  Repository,
  Reservation,
  SessionRecord,
  StoredMessage,
} from './types';

interface SupabaseMessageRow {
  id: string;
  session_id: string;
  content: string;
  x: number;
  y: number;
  status: string;
  created_at: string;
}

interface SupabaseSessionRow {
  id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  blocked: boolean;
}

interface SupabaseReservationRow {
  session_id: string;
  x: number;
  y: number;
  expires_at: string;
}

interface SupabaseReportRow {
  id: string;
  message_id: string;
  reason: string;
  details: string | null;
  reporter_session_id: string;
  status: string;
  created_at: string;
}

interface SupabaseAuditRow {
  id: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  ip: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function toStoredMessage(row: SupabaseMessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    position: { x: row.x, y: row.y },
    createdAt: row.created_at,
    status: row.status as MessageStatus,
  };
}

function toPublicMessage(row: SupabaseMessageRow): WorldMessage {
  return {
    id: row.id,
    content: row.content,
    position: { x: row.x, y: row.y },
    createdAt: row.created_at,
    status: row.status as MessageStatus,
  };
}

export class SupabaseRepository implements Repository {
  private client: SupabaseClient;
  private isTableReady = false;

  constructor(
    private readonly supabaseUrl: string,
    supabaseKey: string,
  ) {
    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
  }

  get ready(): boolean {
    return this.isTableReady;
  }

  async init(): Promise<void> {
    try {
      const { error } = await this.client.from('messages').select('id').limit(1);
      if (error) {
        if (error.code === 'PGRST205' || error.message.includes('Could not find the table')) {
          this.isTableReady = false;
          console.warn(
            `\n[supabase] Notice: Connected to Supabase (${this.supabaseUrl}), but database tables are not initialized yet.`,
          );
          console.warn(
            `[supabase] Please run 'database/supabase_init.sql' in your Supabase Dashboard SQL Editor to initialize the tables.\n`,
          );
          return;
        }
        throw new Error(`Supabase connection error: ${error.message}`);
      }
      this.isTableReady = true;
      console.log(`[supabase] Connected successfully to Supabase (${this.supabaseUrl}). All data will persist to Supabase.`);
    } catch (err) {
      console.warn(`[supabase] Verification warning:`, err);
    }
  }

  async close(): Promise<void> {
    // Supabase REST client doesn't hold open connection pools
  }

  async ping(): Promise<void> {
    const { error } = await this.client.from('messages').select('id').limit(1);
    if (error && error.code !== 'PGRST205') {
      throw new Error(`Supabase ping failed: ${error.message}`);
    }
  }

  // ----------------------------------------------------------- sessions
  async createSession(session: SessionRecord): Promise<void> {
    const { error } = await this.client.from('sessions').insert({
      id: session.id,
      token_hash: session.tokenHash,
      created_at: session.createdAt,
      last_seen_at: session.lastSeenAt,
      blocked: session.blocked,
    });
    if (error) throw new Error(`Supabase createSession error: ${error.message}`);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle<SupabaseSessionRow>();

    if (error) throw new Error(`Supabase findSessionByTokenHash error: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      tokenHash: data.token_hash,
      createdAt: data.created_at,
      lastSeenAt: data.last_seen_at,
      blocked: data.blocked,
    };
  }

  async findSessionById(id: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle<SupabaseSessionRow>();

    if (error) throw new Error(`Supabase findSessionById error: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      tokenHash: data.token_hash,
      createdAt: data.created_at,
      lastSeenAt: data.last_seen_at,
      blocked: data.blocked,
    };
  }

  async touchSession(id: string, at: string): Promise<void> {
    const { error } = await this.client
      .from('sessions')
      .update({ last_seen_at: at })
      .eq('id', id);
    if (error) throw new Error(`Supabase touchSession error: ${error.message}`);
  }

  async setSessionBlocked(id: string, blocked: boolean): Promise<boolean> {
    const { error, count } = await this.client
      .from('sessions')
      .update({ blocked })
      .eq('id', id);
    if (error) throw new Error(`Supabase setSessionBlocked error: ${error.message}`);
    return (count ?? 0) > 0;
  }

  // ----------------------------------------------------------- reservations
  async getReservation(sessionId: string, now: string): Promise<Reservation | null> {
    const { data, error } = await this.client
      .from('reservations')
      .select('*')
      .eq('session_id', sessionId)
      .gt('expires_at', now)
      .maybeSingle<SupabaseReservationRow>();

    if (error) throw new Error(`Supabase getReservation error: ${error.message}`);
    if (!data) return null;
    return {
      sessionId: data.session_id,
      position: { x: data.x, y: data.y },
      expiresAt: data.expires_at,
    };
  }

  async tryReserve(
    sessionId: string,
    point: WorldPoint,
    minDistance: number,
    expiresAt: string,
    now: string,
  ): Promise<boolean> {
    const minX = point.x - minDistance;
    const maxX = point.x + minDistance;
    const minY = point.y - minDistance;
    const maxY = point.y + minDistance;
    const minDistSq = minDistance * minDistance;

    // 1. Collision check with existing active/hidden messages
    const { data: msgCandidates, error: msgErr } = await this.client
      .from('messages')
      .select('x, y')
      .neq('status', 'deleted')
      .gte('x', minX)
      .lte('x', maxX)
      .gte('y', minY)
      .lte('y', maxY);

    if (msgErr) throw new Error(`Supabase collision query error: ${msgErr.message}`);

    for (const m of (msgCandidates || []) as Array<{ x: number; y: number }>) {
      const dx = m.x - point.x;
      const dy = m.y - point.y;
      if (dx * dx + dy * dy < minDistSq) return false;
    }

    // 2. Collision check with active reservations of other visitors
    const { data: resCandidates, error: resErr } = await this.client
      .from('reservations')
      .select('x, y, session_id')
      .neq('session_id', sessionId)
      .gt('expires_at', now)
      .gte('x', minX)
      .lte('x', maxX)
      .gte('y', minY)
      .lte('y', maxY);

    if (resErr) throw new Error(`Supabase reservation collision error: ${resErr.message}`);

    for (const r of (resCandidates || []) as Array<{ x: number; y: number }>) {
      const dx = r.x - point.x;
      const dy = r.y - point.y;
      if (dx * dx + dy * dy < minDistSq) return false;
    }

    // 3. Atomically upsert reservation for this visitor
    const { error: upsertErr } = await this.client.from('reservations').upsert(
      {
        session_id: sessionId,
        x: point.x,
        y: point.y,
        expires_at: expiresAt,
      },
      { onConflict: 'session_id' },
    );

    if (upsertErr) throw new Error(`Supabase upsert reservation error: ${upsertErr.message}`);
    return true;
  }

  async releaseReservation(sessionId: string): Promise<void> {
    const { error } = await this.client
      .from('reservations')
      .delete()
      .eq('session_id', sessionId);
    if (error) throw new Error(`Supabase releaseReservation error: ${error.message}`);
  }

  // ----------------------------------------------------------- messages
  async insertMessageAtReservation(
    input: { id: string; sessionId: string; content: string; createdAt: string },
    now: string,
  ): Promise<WorldMessage | null> {
    // 1. Fetch valid reservation
    const { data: res, error: resErr } = await this.client
      .from('reservations')
      .select('*')
      .eq('session_id', input.sessionId)
      .gt('expires_at', now)
      .maybeSingle<SupabaseReservationRow>();

    if (resErr || !res) return null;

    // 2. Insert into messages
    const { error: insertErr } = await this.client.from('messages').insert({
      id: input.id,
      session_id: input.sessionId,
      content: input.content,
      x: res.x,
      y: res.y,
      status: 'active',
      created_at: input.createdAt,
    });

    if (insertErr) throw new Error(`Supabase insert message error: ${insertErr.message}`);

    // 3. Delete reservation
    await this.client.from('reservations').delete().eq('session_id', input.sessionId);

    return {
      id: input.id,
      content: input.content,
      position: { x: res.x, y: res.y },
      createdAt: input.createdAt,
      status: 'active',
    };
  }

  async insertMessages(messages: StoredMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const rows = messages.map((m) => ({
      id: m.id,
      session_id: m.sessionId,
      content: m.content,
      x: m.position.x,
      y: m.position.y,
      status: m.status,
      created_at: m.createdAt,
    }));
    const { error } = await this.client.from('messages').insert(rows);
    if (error) throw new Error(`Supabase insertMessages error: ${error.message}`);
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('id', id)
      .maybeSingle<SupabaseMessageRow>();

    if (error) throw new Error(`Supabase getMessage error: ${error.message}`);
    if (!data) return null;
    return toStoredMessage(data);
  }

  async getMessageAt(point: WorldPoint): Promise<WorldMessage | null> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('x', point.x)
      .eq('y', point.y)
      .neq('status', 'deleted')
      .maybeSingle<SupabaseMessageRow>();

    if (error) throw new Error(`Supabase getMessageAt error: ${error.message}`);
    if (!data) return null;
    return toPublicMessage(data);
  }

  async setMessageStatus(id: string, status: MessageStatus): Promise<boolean> {
    const { error, count } = await this.client
      .from('messages')
      .update({ status })
      .eq('id', id);
    if (error) throw new Error(`Supabase setMessageStatus error: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async queryBounds(bounds: WorldBounds, limit: number): Promise<WorldMessage[]> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('status', 'active')
      .gte('x', Math.round(bounds.minX))
      .lte('x', Math.round(bounds.maxX))
      .gte('y', Math.round(bounds.minY))
      .lte('y', Math.round(bounds.maxY))
      .limit(limit);

    if (error) throw new Error(`Supabase queryBounds error: ${error.message}`);
    return ((data || []) as SupabaseMessageRow[]).map(toPublicMessage);
  }

  async density(
    bounds: WorldBounds,
    cellSize: number,
    maxCells: number,
  ): Promise<DensityCell[]> {
    const messages = await this.queryBounds(bounds, 5000);
    const cells = new Map<string, { cx: number; cy: number; n: number; sx: number; sy: number }>();
    for (const m of messages) {
      const cx = Math.floor(m.position.x / cellSize);
      const cy = Math.floor(m.position.y / cellSize);
      const key = `${cx},${cy}`;
      const existing = cells.get(key);
      if (existing) {
        existing.n++;
        existing.sx += m.position.x;
        existing.sy += m.position.y;
      } else {
        cells.set(key, { cx, cy, n: 1, sx: m.position.x, sy: m.position.y });
      }
    }
    const out: DensityCell[] = [];
    for (const c of cells.values()) {
      out.push({
        cx: c.cx,
        cy: c.cy,
        count: c.n,
        x: Math.round(c.sx / c.n),
        y: Math.round(c.sy / c.n),
      });
    }
    out.sort((a, b) => b.count - a.count);
    return out.slice(0, maxCells);
  }

  async listMessages(
    status: MessageStatus | undefined,
    limit: number,
  ): Promise<Array<StoredMessage & { reportCount: number }>> {
    let query = this.client.from('messages').select('*').limit(limit);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(`Supabase listMessages error: ${error.message}`);
    return ((data || []) as SupabaseMessageRow[]).map((r) => ({
      ...toStoredMessage(r),
      reportCount: 0,
    }));
  }

  async countOccupied(now: string): Promise<number> {
    const [{ count: msgCount }, { count: resCount }] = await Promise.all([
      this.client.from('messages').select('*', { count: 'exact', head: true }).neq('status', 'deleted'),
      this.client.from('reservations').select('*', { count: 'exact', head: true }).gt('expires_at', now),
    ]);
    return (msgCount ?? 0) + (resCount ?? 0);
  }

  // ----------------------------------------------------------- moderation
  async createReport(report: ReportRecord): Promise<void> {
    const { error } = await this.client.from('reports').insert({
      id: report.id,
      message_id: report.messageId,
      reason: report.reason,
      details: report.details,
      reporter_session_id: report.reporterSessionId,
      status: report.status,
      created_at: report.createdAt,
    });
    if (error) throw new Error(`Supabase createReport error: ${error.message}`);
  }

  async hasReport(messageId: string, reporterSessionId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('reports')
      .select('id')
      .eq('message_id', messageId)
      .eq('reporter_session_id', reporterSessionId)
      .maybeSingle<{ id: string }>();

    if (error) throw new Error(`Supabase hasReport error: ${error.message}`);
    return data !== null;
  }

  async listReports(status: ReportStatus | undefined, limit: number): Promise<ReportRecord[]> {
    let query = this.client
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new Error(`Supabase listReports error: ${error.message}`);
    return ((data || []) as SupabaseReportRow[]).map((r) => ({
      id: r.id,
      messageId: r.message_id,
      reason: r.reason as import('@canvas/shared-types').ReportReason,
      details: r.details ?? undefined,
      reporterSessionId: r.reporter_session_id,
      status: r.status as ReportStatus,
      createdAt: r.created_at,
    }));
  }

  async updateReportStatus(id: string, status: ReportStatus): Promise<ReportRecord | null> {
    const { data, error } = await this.client
      .from('reports')
      .update({ status })
      .eq('id', id)
      .select('*')
      .maybeSingle<SupabaseReportRow>();

    if (error) throw new Error(`Supabase updateReportStatus error: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      messageId: data.message_id,
      reason: data.reason as import('@canvas/shared-types').ReportReason,
      details: data.details ?? undefined,
      reporterSessionId: data.reporter_session_id,
      status: data.status as ReportStatus,
      createdAt: data.created_at,
    };
  }

  async addAudit(entry: AuditEntry): Promise<void> {
    const { error } = await this.client.from('audit_logs').insert({
      id: entry.id,
      actor: entry.actor,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      ip: entry.ip,
      metadata: entry.metadata,
      created_at: entry.createdAt,
    });
    if (error) throw new Error(`Supabase addAudit error: ${error.message}`);
  }

  async listAudit(limit: number): Promise<AuditEntry[]> {
    const { data, error } = await this.client
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Supabase listAudit error: ${error.message}`);
    return ((data || []) as SupabaseAuditRow[]).map((a) => ({
      id: a.id,
      actor: a.actor,
      action: a.action,
      targetType: a.target_type,
      targetId: a.target_id,
      ip: a.ip ?? undefined,
      metadata: a.metadata,
      createdAt: a.created_at,
    }));
  }

  async stats(_now: string): Promise<RepoStats> {
    const [{ count: totalMessages }, { count: activeMessages }, { count: totalSessions }, { count: openReports }] =
      await Promise.all([
        this.client.from('messages').select('*', { count: 'exact', head: true }),
        this.client.from('messages').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        this.client.from('sessions').select('*', { count: 'exact', head: true }),
        this.client.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      ]);

    return {
      totalMessages: totalMessages ?? 0,
      activeMessages: activeMessages ?? 0,
      hiddenMessages: 0,
      messagesToday: 0,
      totalSessions: totalSessions ?? 0,
      blockedSessions: 0,
      openReports: openReports ?? 0,
    };
  }
}
