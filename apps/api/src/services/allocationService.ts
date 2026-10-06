import crypto from 'node:crypto';
import {
  MIN_MESSAGE_DISTANCE,
  WORLD_HALF_EXTENT,
  worldSideLength,
  type WorldPoint,
} from '@canvas/shared-types';
import type { Repository } from '../repo/types';

export class AllocationService {
  constructor(
    private readonly repo: Repository,
    private readonly ttlMinutes: number = 24 * 60,
  ) {}

  /**
   * Authoritative server-side position allocation with collision checking and transaction protection.
   * Generates integer coordinates uniformly distributed in the current dynamic world boundary.
   * Retries on collision up to maxRetries.
   */
  async allocatePosition(
    sessionId: string,
    now: string = new Date().toISOString(),
    maxRetries: number = 60,
  ): Promise<{ position: WorldPoint; worldSide: number }> {
    const occupied = await this.repo.countOccupied(now);
    const side = worldSideLength(occupied);
    const halfSide = Math.min(WORLD_HALF_EXTENT, Math.floor(side / 2));

    const expiresAt = new Date(
      Date.parse(now) + this.ttlMinutes * 60 * 1000,
    ).toISOString();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Uniform random integer in [-halfSide, halfSide] snapped to 100-unit grid boxes
      const range = halfSide * 2 + 1;
      const rx = Math.floor((crypto.randomInt(0, range) - halfSide) / 100) * 100;
      const ry = Math.floor((crypto.randomInt(0, range) - halfSide) / 100) * 100;
      const candidate: WorldPoint = { x: rx, y: ry };

      const reserved = await this.repo.tryReserve(
        sessionId,
        candidate,
        MIN_MESSAGE_DISTANCE,
        expiresAt,
        now,
      );

      if (reserved) {
        return { position: candidate, worldSide: side };
      }
    }

    throw new Error(
      `Failed to allocate collision-free position in world (side=${side}) after ${maxRetries} attempts.`,
    );
  }
}
