import type { Request, Response, NextFunction } from 'express';
import { ERROR_CODES, errorResponse } from '@legal-platform/contracts';
import type { RateLimitDecision, RateLimitRule } from './rate-limit.service';

/** What the floor needs: any limiter — in-process OR shared Redis (P10). */
export interface FloorLimiter {
  consume(key: string, rule: RateLimitRule): RateLimitDecision | Promise<RateLimitDecision>;
}

export const GLOBAL_RATE_LIMIT_ENV = 'GLOBAL_RATE_LIMIT_PER_MIN';

/**
 * Platform-wide rate limit (P6-S1, OWASP API4:2023 Unrestricted Resource
 * Consumption). Feature limiters (OTP, verification …) stay stricter — this
 * one is the floor nothing may fall below: a request must first survive the
 * global bucket before any controller logic runs.
 *
 * Keying: real client IP (setup.ts pins `trust proxy`, so `req.ip` is the
 * caller, not the nginx in front). /api/health is exempt so load balancers
 * don't eat the bucket.
 */
export function globalRateLimitMiddleware(
  rateLimiter: FloorLimiter,
  perMinute: number,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/api/health' || req.path === '/health') return next();

    // The limiter may be synchronous (in-process) or async (shared Redis);
    // the floor supports both without lying about which one served.
    const settle = (decision: RateLimitDecision): void => {
      if (decision.allowed) {
        res.setHeader('X-RateLimit-Limit', String(perMinute));
        res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
        return next();
      }
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      // P10: the floor is plain middleware (outside Nest's route pipeline),
      // and async limiters cannot throw into the global filter — so render
      // the EXACT same SPEC §7 payload directly. Same shape, both drivers.
      res.status(429).json(errorResponse(ERROR_CODES.SECURITY_RATE_LIMITED, ERROR_CODES.SECURITY_RATE_LIMITED));
    };
    try {
      void Promise.resolve(rateLimiter.consume(`global:${req.ip}`, { limit: perMinute, windowMs: 60_000 }))
        .then(settle)
        .catch(next);
    } catch (e) {
      next(e);
    }
  };
}
