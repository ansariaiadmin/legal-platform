import { Injectable, OnModuleDestroy } from '@nestjs/common';

export interface RateLimitRule {
  /** Maximum number of hits allowed inside `windowMs`. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Optional minimum spacing between two successful hits. */
  cooldownMs?: number;
  /** How long to reject everything once `limit` is exceeded. */
  lockMs?: number;
}

export type RateLimitRejection = 'limit' | 'cooldown' | 'locked';

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  rejection?: RateLimitRejection;
}

interface Bucket {
  count: number;
  windowStartedAt: number;
  lastHitAt?: number;
  lockedUntil?: number;
}

/**
 * Fixed-window counter with optional per-key cooldown and lockout.
 *
 * Correctness notes (these were the bugs in the previous inline version):
 * - a hit is counted exactly once, when it is admitted;
 * - the cooldown is evaluated BEFORE the counter is touched, so a rejected
 *   request no longer burns quota;
 * - expired buckets are evicted by a sweeper, so the map cannot grow without
 *   bound.
 *
 * This is an in-process store: it is correct for a single API instance but is
 * NOT shared with the worker or with additional API replicas. Swapping in a
 * Redis-backed implementation is the documented next step.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.evictExpired(), 60_000);
    // Never keep the process alive just for the sweeper.
    this.sweeper.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  consume(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (bucket && bucket.lockedUntil && now < bucket.lockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000),
        rejection: 'locked',
      };
    }

    if (!bucket || now - bucket.windowStartedAt >= rule.windowMs) {
      bucket = { count: 0, windowStartedAt: now };
      this.buckets.set(key, bucket);
    }

    if (rule.cooldownMs && bucket.lastHitAt && now - bucket.lastHitAt < rule.cooldownMs) {
      return {
        allowed: false,
        remaining: Math.max(0, rule.limit - bucket.count),
        retryAfterSeconds: Math.ceil((bucket.lastHitAt + rule.cooldownMs - now) / 1000),
        rejection: 'cooldown',
      };
    }

    if (bucket.count >= rule.limit) {
      const lockMs = rule.lockMs ?? rule.windowMs;
      bucket.lockedUntil = now + lockMs;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(lockMs / 1000),
        rejection: 'limit',
      };
    }

    bucket.count += 1;
    bucket.lastHitAt = now;

    return {
      allowed: true,
      remaining: Math.max(0, rule.limit - bucket.count),
      retryAfterSeconds: 0,
    };
  }

  /** Clears a key, e.g. after a successful OTP verification. */
  reset(...keys: string[]): void {
    for (const key of keys) {
      this.buckets.delete(key);
    }
  }

  /** Visible for tests. */
  size(): number {
    return this.buckets.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      const idleFor = now - (bucket.lastHitAt ?? bucket.windowStartedAt);
      if (idleFor > 30 * 60 * 1000) {
        this.buckets.delete(key);
      }
    }
  }
}
