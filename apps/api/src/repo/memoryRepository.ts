import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  CHUNK_SIZE,
  type AuditEntry,
  type DensityCell,
  type MessageStatus,
  type ReportRecord,
  type ReportStatus,
  type WorldBounds,
  type WorldMessage,
  type WorldPoint,
} from '@canvas/shared-types';
import type {
  RepoStats,
  Repository,
  Reservation,
  SessionRecord,
  StoredMessage,
} from './types';

interface Snapshot {
  version: 1;
  messages: StoredMessage[];
  sessions: SessionRecord[];
  reservations: Reservation[];
  reports: ReportRecord[];
  audit: AuditEntry[];
}

const chunkIdx = (v: number) => Math.floor(v / CHUNK_SIZE);
const ckey = (cx: number, cy: number) => `${cx},${cy}`;
const pkey = (p: WorldPoint) => `${p.x},${p.y}`;

function toPublic(m: StoredMessage): WorldMessage {
  const { sessionId: _sessionId, ...pub } = m;
  return pub;
}

/**
 * In-memory adapter with optional JSON snapshot persistence. Single-process only.
 * All methods are synchronous inside, so each is trivially atomic on the event loop.
 */
export class MemoryRepository implements Repository {
  private messages = new Map<string, StoredMessage>();
  private chunks = new Map<string, StoredMessage[]>();
  private byPosition = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private sessionsByHash = new Map<string, string>();
  private reservations = new Map<string, Reservation>();
  private resChunks = new Map<string, Set<string>>();
  private reports = new Map<string, ReportRecord>();
  private audit: AuditEntry[] = [];

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(private readonly dataFile: string | null = null) {}

  // ----------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    if (!this.dataFile) return;
    try {
      const raw = await readFile(this.dataFile, 'utf8');
      const snap = JSON.parse(raw) as Snapshot;
      for (const m of snap.messages) this.indexMessage(m);
      for (const s of snap.sessions) {
        this.sessions.set(s.id, s);
        this.sessionsByHash.set(s.tokenHash, s.id);
      }
      for (const r of snap.reservations) this.indexReservation(r);
      for (const r of snap.reports) this.reports.set(r.id, r);
      this.audit = snap.audit;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async close(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await this.flush();
  }

  async ping(): Promise<void> {
    /* always healthy */
  }

  private markDirty(): void {
    if (!this.dataFile) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 500);
    this.saveTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.dataFile || !this.dirty) return;
    this.dirty = false;
    const snap: Snapshot = {
      version: 1,
      messages: [...this.messages.values()],
      sessions: [...this.sessions.values()],
      reservations: [...this.reservations.values()],
      reports: [...this.reports.values()],
      audit: this.audit,
    };
    await mkdir(dirname(this.dataFile), { recursive: true });
    const tmp = `${this.dataFile}.tmp`;
    await writeFile(tmp, JSON.stringify(snap));
    await rename(tmp, this.dataFile);
  }

  // ----------------------------------------------------------- indexing

  private indexMessage(m: StoredMessage): void {
    this.messages.set(m.id, m);
    const key = ckey(chunkIdx(m.position.x), chunkIdx(m.position.y));
    const bucket = this.chunks.get(key);
    if (bucket) bucket.push(m);
    else this.chunks.set(key, [m]);
    if (m.status !== 'deleted') this.byPosition.set(pkey(m.position), m.id);
  }

  private indexReservation(r: Reservation): void {
    this.reservations.set(r.sessionId, r);
    const key = ckey(chunkIdx(r.position.x), chunkIdx(r.position.y));
    const set = this.resChunks.get(key);
    if (set) set.add(r.sessionId);
    else this.resChunks.set(key, new Set([r.sessionId]));
  }

  private unindexReservation(sessionId: string): void {
    const r = this.reservations.get(sessionId);
    if (!r) return;
    this.reservations.delete(sessionId);
    const key = ckey(chunkIdx(r.position.x), chunkIdx(r.position.y));
    const set = this.resChunks.get(key);
    set?.delete(sessionId);
    if (set && set.size === 0) this.resChunks.delete(key);
  }

  // ----------------------------------------------------------- sessions

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
    this.sessionsByHash.set(session.tokenHash, session.id);
    this.markDirty();
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const id = this.sessionsByHash.get(tokenHash);
    return id ? (this.sessions.get(id) ?? null) : null;
  }

  async findSessionById(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async touchSession(id: string, at: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    s.lastSeenAt = at;
    this.markDirty();
  }

  async setSessionBlocked(id: string, blocked: boolean): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.blocked = blocked;
    this.markDirty();
    return true;
  }

  // ----------------------------------------------------------- positions

  async getReservation(sessionId: string, now: string): Promise<Reservation | null> {
    const r = this.reservations.get(sessionId);
    if (!r) return null;
    if (r.expiresAt <= now) {
      this.unindexReservation(sessionId);
      return null;
    }
    return r;
  }

  async tryReserve(
    sessionId: string,
    point: WorldPoint,
    minDistance: number,
    expiresAt: string,
    now: string,
  ): Promise<boolean> {
    if (minDistance <= 100) {
      const cx = chunkIdx(point.x);
      const cy = chunkIdx(point.y);
      for (const m of this.chunks.get(ckey(cx, cy)) ?? []) {
        if (m.status === 'deleted') continue;
        if (m.position.x === point.x && m.position.y === point.y) return false;
      }
      const owners = this.resChunks.get(ckey(cx, cy));
      if (owners) {
        for (const owner of owners) {
          if (owner === sessionId) continue;
          const r = this.reservations.get(owner);
          if (!r || r.expiresAt <= now) continue;
          if (r.position.x === point.x && r.position.y === point.y) return false;
        }
      }
    } else {
      const min2 = minDistance * minDistance;
      const cx = chunkIdx(point.x);
      const cy = chunkIdx(point.y);
      const radius = Math.max(1, Math.ceil(minDistance / CHUNK_SIZE));

      for (let ix = cx - radius; ix <= cx + radius; ix++) {
        for (let iy = cy - radius; iy <= cy + radius; iy++) {
          const key = ckey(ix, iy);
          for (const m of this.chunks.get(key) ?? []) {
            if (m.status === 'deleted') continue;
            const dx = m.position.x - point.x;
            const dy = m.position.y - point.y;
            if (dx * dx + dy * dy < min2) return false;
          }
          const owners = this.resChunks.get(key);
          if (owners) {
            for (const owner of owners) {
              if (owner === sessionId) continue;
              const r = this.reservations.get(owner);
              if (!r) continue;
              if (r.expiresAt <= now) continue; // expired: ignore (purged lazily)
              const dx = r.position.x - point.x;
              const dy = r.position.y - point.y;
              if (dx * dx + dy * dy < min2) return false;
            }
          }
        }
      }
    }

    this.unindexReservation(sessionId);
    this.indexReservation({ sessionId, position: { x: point.x, y: point.y }, expiresAt });
    this.markDirty();
    return true;
  }

  async releaseReservation(sessionId: string): Promise<void> {
    this.unindexReservation(sessionId);
    this.markDirty();
  }

  // ----------------------------------------------------------- messages

  async insertMessageAtReservation(
    input: { id: string; sessionId: string; content: string; createdAt: string },
    now: string,
  ): Promise<WorldMessage | null> {
    const reservation = await this.getReservation(input.sessionId, now);
    if (!reservation) return null;
    if (this.byPosition.has(pkey(reservation.position))) return null;
    const stored: StoredMessage = {
      id: input.id,
      sessionId: input.sessionId,
      content: input.content,
      position: { ...reservation.position },
      createdAt: input.createdAt,
      status: 'active',
    };
    this.indexMessage(stored);
    this.unindexReservation(input.sessionId);
    this.markDirty();
    return toPublic(stored);
  }

  async insertMessages(messages: StoredMessage[]): Promise<void> {
    for (const m of messages) this.indexMessage(m);
    this.markDirty();
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    return this.messages.get(id) ?? null;
  }

  async getMessageAt(point: WorldPoint): Promise<WorldMessage | null> {
    const id = this.byPosition.get(pkey(point));
    const m = id ? this.messages.get(id) : undefined;
    return m && m.status === 'active' ? toPublic(m) : null;
  }

  async setMessageStatus(id: string, status: MessageStatus): Promise<boolean> {
    const m = this.messages.get(id);
    if (!m) return false;
    m.status = status;
    const key = pkey(m.position);
    if (status === 'deleted') {
      if (this.byPosition.get(key) === id) this.byPosition.delete(key);
    } else {
      this.byPosition.set(key, id);
    }
    this.markDirty();
    return true;
  }

  private *bucketsIn(bounds: WorldBounds): Generator<StoredMessage[]> {
    const minCx = chunkIdx(bounds.minX);
    const maxCx = chunkIdx(bounds.maxX);
    const minCy = chunkIdx(bounds.minY);
    const maxCy = chunkIdx(bounds.maxY);
    const span = (maxCx - minCx + 1) * (maxCy - minCy + 1);
    if (span > this.chunks.size) {
      yield* this.chunks.values();
      return;
    }
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.chunks.get(ckey(cx, cy));
        if (bucket) yield bucket;
      }
    }
  }

  async queryBounds(bounds: WorldBounds, limit: number): Promise<WorldMessage[]> {
    const out: WorldMessage[] = [];
    for (const bucket of this.bucketsIn(bounds)) {
      for (const m of bucket) {
        if (m.status !== 'active') continue;
        const { x, y } = m.position;
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
        out.push(toPublic(m));
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  async density(bounds: WorldBounds, cellSize: number, maxCells: number): Promise<DensityCell[]> {
    const cells = new Map<string, { cx: number; cy: number; n: number; sx: number; sy: number }>();
    for (const bucket of this.bucketsIn(bounds)) {
      for (const m of bucket) {
        if (m.status !== 'active') continue;
        const { x, y } = m.position;
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
        const cx = Math.floor(x / cellSize);
        const cy = Math.floor(y / cellSize);
        const key = ckey(cx, cy);
        const cell = cells.get(key);
        if (cell) {
          cell.n++;
          cell.sx += x;
          cell.sy += y;
        } else {
          cells.set(key, { cx, cy, n: 1, sx: x, sy: y });
        }
      }
    }
    const out: DensityCell[] = [];
    for (const c of cells.values()) {
      out.push({ cx: c.cx, cy: c.cy, count: c.n, x: Math.round(c.sx / c.n), y: Math.round(c.sy / c.n) });
    }
    out.sort((a, b) => b.count - a.count);
    return out.slice(0, maxCells);
  }

  async listMessages(status: MessageStatus | undefined, limit: number) {
    const counts = new Map<string, number>();
    for (const r of this.reports.values()) counts.set(r.messageId, (counts.get(r.messageId) ?? 0) + 1);
    const rows = [...this.messages.values()].filter((m) => !status || m.status === status);
    rows.sort((a, b) => {
      const byReports = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
      return byReports !== 0 ? byReports : b.createdAt.localeCompare(a.createdAt);
    });
    return rows.slice(0, limit).map((m) => ({ ...m, reportCount: counts.get(m.id) ?? 0 }));
  }

  async countOccupied(now: string): Promise<number> {
    let live = 0;
    for (const r of this.reservations.values()) if (r.expiresAt > now) live++;
    let msgs = 0;
    for (const m of this.messages.values()) if (m.status !== 'deleted') msgs++;
    return msgs + live;
  }

  // ----------------------------------------------------------- moderation

  async createReport(report: ReportRecord): Promise<void> {
    this.reports.set(report.id, report);
    this.markDirty();
  }

  async hasReport(messageId: string, reporterSessionId: string): Promise<boolean> {
    for (const r of this.reports.values()) {
      if (r.messageId === messageId && r.reporterSessionId === reporterSessionId) return true;
    }
    return false;
  }

  async listReports(status: ReportStatus | undefined, limit: number): Promise<ReportRecord[]> {
    return [...this.reports.values()]
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async updateReportStatus(id: string, status: ReportStatus): Promise<ReportRecord | null> {
    const r = this.reports.get(id);
    if (!r) return null;
    r.status = status;
    this.markDirty();
    return r;
  }

  async addAudit(entry: AuditEntry): Promise<void> {
    this.audit.push(entry);
    this.markDirty();
  }

  async listAudit(limit: number): Promise<AuditEntry[]> {
    return this.audit.slice(-limit).reverse();
  }

  async stats(now: string): Promise<RepoStats> {
    const dayAgo = new Date(Date.parse(now) - 24 * 3600 * 1000).toISOString();
    let active = 0;
    let hidden = 0;
    let today = 0;
    for (const m of this.messages.values()) {
      if (m.status === 'active') active++;
      if (m.status === 'hidden') hidden++;
      if (m.createdAt >= dayAgo) today++;
    }
    let blocked = 0;
    for (const s of this.sessions.values()) if (s.blocked) blocked++;
    let open = 0;
    for (const r of this.reports.values()) if (r.status === 'open') open++;
    return {
      totalMessages: this.messages.size,
      activeMessages: active,
      hiddenMessages: hidden,
      messagesToday: today,
      totalSessions: this.sessions.size,
      blockedSessions: blocked,
      openReports: open,
    };
  }
}
