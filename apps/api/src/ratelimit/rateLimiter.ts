import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  /** Count one hit for `key` in a fixed window and report whether it is within `limit`. */
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  close(): Promise<void>;
}

/** Per-process fixed-window limiter. Fine for one instance; use Redis for several. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(private readonly now: () => number = Date.now) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  private sweep(): void {
    const t = this.now();
    for (const [key, w] of this.windows) if (w.resetAt <= t) this.windows.delete(key);
  }

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return {
      allowed: w.count <= limit,
      remaining: Math.max(0, limit - w.count),
      retryAfterSec: Math.ceil((w.resetAt - t) / 1000),
    };
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
  }
}

/** Redis-backed fixed-window limiter, shared across API instances. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const k = `rl:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.pexpire(k, windowMs);
    const ttl = await this.redis.pttl(k);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: Math.ceil(Math.max(ttl, 0) / 1000),
    };
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
