/** World model constants shared by the web client and the API. */

/** The world spans [-WORLD_HALF_EXTENT, +WORLD_HALF_EXTENT] on both axes (integers). */
export const WORLD_HALF_EXTENT = 1_000_000;
/** Minimum distance (world units) between any two messages (each grid box is 100x100). */
export const MIN_MESSAGE_DISTANCE = 100;
/** Edge length of a spatial chunk, in world units. */
export const CHUNK_SIZE = 1000;
/** Content limits. 1000 words is NOT 1000 characters, so both are enforced. */
export const MAX_MESSAGE_WORDS = 1000;
export const MAX_MESSAGE_CHARS = 10_000;

/** A position in world coordinates. +x is right, +y is up. Never a screen position. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in world coordinates (inclusive). */
export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type MessageStatus = 'active' | 'hidden' | 'deleted';

export interface WorldMessage {
  id: string;
  content: string;
  position: WorldPoint;
  createdAt: string;
  author?: {
    id: string;
    name: string;
  };
  status: MessageStatus;
}

/** Consistent API envelopes. */
export interface ApiSuccess<T, M = Record<string, unknown>> {
  success: true;
  data: T;
  meta?: M;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T, M = Record<string, unknown>> = ApiSuccess<T, M> | ApiError;

/* ------------------------------------------------------------------ world sizing */

/** Area of the world with zero users: 10,000 x 10,000. */
export const WORLD_BASE_AREA = 10_000 * 10_000;
/** Extra area granted per occupied position (a 1,000 x 1,000 plot each). */
export const WORLD_SPACE_PER_USER = 1_000 * 1_000;
/** Largest allowed edge length of the whole world. */
export const WORLD_MAX_SIDE = WORLD_HALF_EXTENT * 2;

/**
 * Edge length of the (square, origin-centred) region new positions are allocated in.
 * worldArea = baseArea + occupied * spacePerUser; side = sqrt(area), capped at the world size.
 * Existing messages never move when the world grows.
 */
export function worldSideLength(occupied: number): number {
  const area = WORLD_BASE_AREA + Math.max(0, occupied) * WORLD_SPACE_PER_USER;
  return Math.min(WORLD_MAX_SIDE, Math.ceil(Math.sqrt(area)));
}

/* ------------------------------------------------------------------ query limits */

/** Max edge length of a viewport query on /world/messages. */
export const MAX_MESSAGE_QUERY_SPAN = 200_000;
export const DEFAULT_MESSAGE_LIMIT = 2_000;
export const MAX_MESSAGE_LIMIT = 5_000;
/** Max cells returned by /world/density. */
export const MAX_DENSITY_CELLS = 2_500;

/* ------------------------------------------------------------------ API payloads */

export interface DensityCell {
  /** Cell index along x / y (cell covers [cx*cellSize, (cx+1)*cellSize)). */
  cx: number;
  cy: number;
  count: number;
  /** Centroid of the messages in the cell. */
  x: number;
  y: number;
}

export interface SessionInfo {
  sessionId: string;
  token?: string;
  /** The server-allocated position this visitor may write at, or null if none could be allocated. */
  position: WorldPoint | null;
  worldSide: number;
  limits: {
    maxWords: number;
    maxChars: number;
  };
}

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'illegal',
  'personal_information',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface ReportRecord {
  id: string;
  messageId: string;
  reason: ReportReason;
  details?: string;
  reporterSessionId: string;
  status: ReportStatus;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  ip?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminStats {
  totalMessages: number;
  activeMessages: number;
  hiddenMessages: number;
  messagesToday: number;
  totalSessions: number;
  blockedSessions: number;
  openReports: number;
  worldSide: number;
  worldUtilization: number;
}

/* ------------------------------------------------------------------ realtime protocol */

export type ClientWsMessage =
  | { type: 'subscribe'; bounds: WorldBounds }
  | { type: 'unsubscribe' }
  | { type: 'ping' };

export type ServerWsMessage =
  | { type: 'hello'; maxChunks: number }
  | { type: 'subscribed'; chunks: number }
  | { type: 'message.created'; message: WorldMessage }
  | { type: 'message.removed'; id: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };
