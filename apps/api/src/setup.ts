import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { EnvService } from './config/env';
import { RateLimitService } from './common/rate-limit.service';
import { securityHeadersMiddleware } from './common/security-headers.middleware';
import { globalRateLimitMiddleware, GLOBAL_RATE_LIMIT_ENV } from './common/global-rate-limit.middleware';
import { RedisRateLimitService } from './common/redis-rate-limit.service';
import type { FloorLimiter } from './common/global-rate-limit.middleware';

/** Comma-separated allow-list; APP_URL is always permitted. */
export function corsOrigins(env: EnvService): string[] {
  const configured = (env.get('CORS_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const appUrl = env.get('APP_URL').trim();
  const origins = appUrl ? [appUrl, ...configured] : configured;

  return [...new Set(origins)];
}

/**
 * Cross-cutting HTTP configuration shared by `main.ts` and the integration
 * tests, so a test can never pass against a setup the server does not use.
 */
export function configureApp(app: INestApplication, env: EnvService): void {
  // nginx sits in front and forwards the real client address; without this
  // `@Ip()` - and therefore OTP rate limiting - sees the proxy for everyone.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // P6-S1: disclose nothing, then rate-limit everything. x-powered-by off
  // (fingerprint minimization), security headers for every response, global
  // per-IP bucket before any controller — feature limiters still apply AFTER.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  if ((env.get('SECURITY_HEADERS') || 'on') !== 'off') {
    app.use(securityHeadersMiddleware(env.isProduction));
  }
  // P10-T-floor: shared Redis limiter when RATE_LIMIT_DRIVER=redis (visible
  // on /dashboard/ops/deployment); otherwise the honest in-process floor.
  const sharedLimiter = app.get(RedisRateLimitService, { strict: false }) as RedisRateLimitService | null;
  const floor: FloorLimiter = sharedLimiter ?? app.get(RateLimitService);
  app.use(
    globalRateLimitMiddleware(
      floor,
      Number(env.get(GLOBAL_RATE_LIMIT_ENV)) || 300,
    ),
  );

  // Every request gets an id so logs can be correlated (SPEC section 10).
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    req.id = incoming && incoming.length <= 128 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  const origins = corsOrigins(env);
  app.enableCors({
    // Secure by default: no origins configured means no CORS headers at all.
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
  });

  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );

  // SPEC section 7: /api/public/*, /api/dashboard/*, /api/webhooks/*
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}
