import type {
  AuditEntry,
  DensityCell,
  ReportRecord,
  ReportStatus,
  WorldBounds,
  WorldMessage,
  WorldPoint,
  MessageStatus,
} from '@canvas/shared-types';

export interface SessionRecord {
  id: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  blocked: boolean;
}

export interface Reservation {
  sessionId: string;
  position: WorldPoint;
  expiresAt: string;
}

/** A message plus its (private) owner. Public APIs only ever expose {@link WorldMessage}. */
export interface StoredMessage extends WorldMessage {
  sessionId: string;
}

export interface RepoStats {
  totalMessages: number;
  activeMessages: number;
  hiddenMessages: number;
  messagesToday: number;
  totalSessions: number;
  blockedSessions: number;
  openReports: number;
}

/**
 * Storage port. Two adapters implement it: in-memory (dev/test, JSON snapshot) and
 * PostgreSQL + PostGIS (production). Every method that must be atomic is documented.
 */
export interface Repository {
  init(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<void>;

  // sessions
  createSession(session: SessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findSessionById(id: string): Promise<SessionRecord | null>;
  touchSession(id: string, at: string): Promise<void>;
  setSessionBlocked(id: string, blocked: boolean): Promise<boolean>;

  // positions
  getReservation(sessionId: string, now: string): Promise<Reservation | null>;
  /**
   * ATOMIC: if no message / live reservation (of another session) lies within `minDistance`
   * of `point`, reserve it for `sessionId` (replacing its previous reservation) and return true.
   * Concurrent callers must never both succeed for positions closer than `minDistance`.
   */
  tryReserve(
    sessionId: string,
    point: WorldPoint,
    minDistance: number,
    expiresAt: string,
    now: string,
  ): Promise<boolean>;
  releaseReservation(sessionId: string): Promise<void>;

  // messages
  /**
   * ATOMIC: turn the session's live reservation into a message and delete the reservation.
   * Returns null if the session has no live reservation.
   */
  insertMessageAtReservation(
    input: { id: string; sessionId: string; content: string; createdAt: string },
    now: string,
  ): Promise<WorldMessage | null>;
  /** Bulk import (seeding). Bypasses allocation; caller guarantees spacing. */
  insertMessages(messages: StoredMessage[]): Promise<void>;
  getMessage(id: string): Promise<StoredMessage | null>;
  getMessageAt(point: WorldPoint): Promise<WorldMessage | null>;
  setMessageStatus(id: string, status: MessageStatus): Promise<boolean>;
  /** Active messages inside `bounds` (inclusive). */
  queryBounds(bounds: WorldBounds, limit: number): Promise<WorldMessage[]>;
  /** Active message counts per grid cell inside `bounds`. */
  density(bounds: WorldBounds, cellSize: number, maxCells: number): Promise<DensityCell[]>;
  listMessages(
    status: MessageStatus | undefined,
    limit: number,
  ): Promise<Array<StoredMessage & { reportCount: number }>>;
  /** Messages + live reservations: the number of occupied positions. */
  countOccupied(now: string): Promise<number>;

  // moderation
  createReport(report: ReportRecord): Promise<void>;
  hasReport(messageId: string, reporterSessionId: string): Promise<boolean>;
  listReports(status: ReportStatus | undefined, limit: number): Promise<ReportRecord[]>;
  updateReportStatus(id: string, status: ReportStatus): Promise<ReportRecord | null>;
  addAudit(entry: AuditEntry): Promise<void>;
  listAudit(limit: number): Promise<AuditEntry[]>;
  stats(now: string): Promise<RepoStats>;
}
