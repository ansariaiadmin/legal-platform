import type { Request, Response, NextFunction } from 'express';
import { HttpException } from '@nestjs/common';
import { ERROR_CODES } from '@legal-platform/contracts';
import type { RateLimitService } from './rate-limit.service';

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
  rateLimiter: RateLimitService,
  perMinute: number,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/api/health' || req.path === '/health') return next();

    const decision = rateLimiter.consume(`global:${req.ip}`, {
      limit: perMinute,
      windowMs: 60_000,
    });
    if (decision.allowed) {
      res.setHeader('X-RateLimit-Limit', String(perMinute));
      res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
      return next();
    }
    res.setHeader('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpException(ERROR_CODES.SECURITY_RATE_LIMITED, 429);
  };
}
