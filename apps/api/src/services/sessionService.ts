import crypto from 'node:crypto';
import {
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_WORDS,
  MIN_MESSAGE_DISTANCE,
  WORLD_HALF_EXTENT,
  worldSideLength,
  type SessionInfo,
  type WorldPoint,
} from '@canvas/shared-types';
import type { Repository, SessionRecord } from '../repo/types';
import type { AllocationService } from './allocationService';
import type { RateLimiter } from '../ratelimit/rateLimiter';
import { AppError } from '../errors';

export class SessionService {
  constructor(
    private readonly repo: Repository,
    private readonly allocationService: AllocationService,
    private readonly rateLimiter: RateLimiter,
    private readonly secret: string,
    private readonly reallocLimit: number = 6,
  ) {}

  hashToken(token: string): string {
    return crypto.createHmac('sha256', this.secret).update(token).digest('hex');
  }

  generateToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  async getOrCreateSession(token: string | undefined): Promise<{
    session: SessionRecord;
    rawToken: string;
    isNew: boolean;
  }> {
    const now = new Date().toISOString();
    if (token) {
      const hash = this.hashToken(token);
      const existing = await this.repo.findSessionByTokenHash(hash);
      if (existing) {
        if (existing.blocked) {
          throw AppError.forbidden('SESSION_BLOCKED', 'This session has been suspended.');
        }
        await this.repo.touchSession(existing.id, now);
        return { session: existing, rawToken: token, isNew: false };
      }
    }

    const rawToken = this.generateToken();
    const tokenHash = this.hashToken(rawToken);
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      tokenHash,
      createdAt: now,
      lastSeenAt: now,
      blocked: false,
    };
    await this.repo.createSession(session);
    return { session, rawToken, isNew: true };
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo> {
    const now = new Date().toISOString();
    let reservation = await this.repo.getReservation(sessionId, now);

    const occupied = await this.repo.countOccupied(now);
    const side = worldSideLength(occupied);

    if (!reservation) {
      // Allocate initial position
      try {
        const allocated = await this.allocationService.allocatePosition(sessionId, now);
        reservation = {
          sessionId,
          position: allocated.position,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        };
      } catch (err) {
        console.error('Failed to auto-allocate initial reservation:', err);
      }
    }

    return {
      sessionId,
      position: reservation ? reservation.position : null,
      worldSide: side,
      limits: {
        maxWords: MAX_MESSAGE_WORDS,
        maxChars: MAX_MESSAGE_CHARS,
      },
    };
  }

  async reallocatePosition(sessionId: string): Promise<SessionInfo> {
    // Check rate limit on reallocations to prevent camping
    const rlKey = `realloc:${sessionId}`;
    const rl = await this.rateLimiter.hit(rlKey, this.reallocLimit, 10 * 60 * 1000);
    if (!rl.allowed) {
      throw AppError.tooMany(
        rl.retryAfterSec,
        'Position reallocation rate limit reached. Please explore or write at your current location.',
      );
    }

    const now = new Date().toISOString();
    await this.allocationService.allocatePosition(sessionId, now);
    return this.getSessionInfo(sessionId);
  }

  async reservePosition(sessionId: string, target: WorldPoint): Promise<SessionInfo> {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const x = Math.max(-WORLD_HALF_EXTENT, Math.min(WORLD_HALF_EXTENT, Math.floor(target.x / 100) * 100));
    const y = Math.max(-WORLD_HALF_EXTENT, Math.min(WORLD_HALF_EXTENT, Math.floor(target.y / 100) * 100));
    const candidate: WorldPoint = { x, y };

    const reserved = await this.repo.tryReserve(
      sessionId,
      candidate,
      MIN_MESSAGE_DISTANCE,
      expiresAt,
      now,
    );

    if (!reserved) {
      throw AppError.conflict(
        'POSITION_COLLISION',
        'This coordinate is already occupied by another message.',
      );
    }

    return this.getSessionInfo(sessionId);
  }
}
