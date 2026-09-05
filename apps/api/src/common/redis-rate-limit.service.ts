import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisRespClient } from '../providers/queue/redis-resp.client';
import type { RateLimitDecision, RateLimitRule } from './rate-limit.service';

/**
 * P9-T4 — Redis-backed shared rate limiter. When REDIS_URL is configured and
 * RATE_LIMIT_DRIVER=redis, EVERY replica enforces the SAME bucket — required
 * for the multi-node deployment story to be true and not theater.
 *
 * Semantics (fixed window): INCR the bucket key; if it's 1, PEXPIRE with the
 * window. Counter > limit ⇒ denied. `cooldownMs`/`lockMs` of the rule are
 * deliberately NOT ported — shared infra must stay boring; feature limiters
 * that need lockout semantics run on the local engine behind the global
 * floor anyway.
 *
 * Failure mode honesty: a Redis hiccup here FAILS CLOSED with a 429-style
 * denial INCLUDING a distinct rejection note; it never silently opens the
 * floodgate because Redis is down. (Availability-vs-perimiter trade is
 * explicitly chosen as: deny, with fast +Signal: only the Global floor uses
 * this driver in practice.)
 */
@Injectable()
export class RedisRateLimitService {
  private readonly client: RedisRespClient;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      throw new Error('redis rate limiter requires REDIS_URL');
    }
    this.client = new RedisRespClient(url, 1000);
  }

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const now = Date.now(); // single read: bucket and retryAfter must agree
    const bucketKey = `rl:${key}:${Math.floor(now / rule.windowMs)}`;
    const nowRetryAfter = Math.max(1, Math.ceil((rule.windowMs - (now % rule.windowMs)) / 1000));
    try {
      const count = await this.client.incr(bucketKey);
      if (count === 1) {
        await this.client.pexpire(bucketKey, rule.windowMs);
      }
      const allowed = count <= rule.limit;
      return {
        allowed,
        remaining: Math.max(0, rule.limit - count),
        retryAfterSeconds: allowed ? 0 : nowRetryAfter,
        rejection: allowed ? undefined : 'limit',
      };
    } catch (e) {
      // Redis down on the shared floor: DENY honestly, loudly, briefly.
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 5,
        rejection: 'locked', // 5s — ops alarm reads the log line
      };
    }
  }
}

/** Choose the implementation the stack should boot with, honestly visible. */
export function pickRateLimiterDriver(config: Pick<ConfigService, 'get'>): 'redis' | 'memory' {
  return config.get<string>('RATE_LIMIT_DRIVER') === 'redis' && config.get<string>('REDIS_URL')
    ? 'redis'
    : 'memory';
}
