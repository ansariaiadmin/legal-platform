import { RequestMethod, ValidationPipe, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { EnvService } from './config/env';
import { RateLimitService } from './common/rate-limit.service';
import { securityHeadersMiddleware } from './common/security-headers.middleware';
import { globalRateLimitMiddleware, GLOBAL_RATE_LIMIT_ENV } from './common/global-rate-limit.middleware';
import { RedisRateLimitService } from './common/redis-rate-limit.service';
import type { FloorLimiter } from './common/global-rate-limit.middleware';
import { MetricsService } from './modules/health/metrics.service';
import { metricsMiddleware } from './common/metrics.middleware';
import { helmetMiddleware, defaultHelmetConfig } from './common/helmet.middleware';

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
  // Helmet.js equivalent — OWASP secure headers
  app.use(helmetMiddleware(defaultHelmetConfig));
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

  // Prometheus metrics middleware — must be early to capture all requests
  try {
    const metricsService = app.get(MetricsService, { strict: false }) as MetricsService | null;
    if (metricsService) {
      app.use(metricsMiddleware(metricsService));
    }
  } catch {
    // Metrics service not available in some test contexts — skip
  }

  const origins = corsOrigins(env);
  app.enableCors({
    // Secure by default: no origins configured means no CORS headers at all.
    // Strict CORS: only allow configured origins, no wildcard in production.
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, curl, same-origin)
      if (!origin) {
        return callback(null, true);
      }
      if (origins.length === 0) {
        // In production with no origins configured, deny all cross-origin
        return callback(null, false);
      }
      if (origins.includes(origin)) {
        return callback(null, true);
      }
      // Log blocked origin for security monitoring
      callback(new Error(`CORS blocked: ${origin} not in allowed list`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 86400, // 24h preflight cache
  });

  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );

  // SPEC section 7: /api/public/*, /api/dashboard/*, /api/webhooks/*
  // P11: the bare host gets a billboard, not a 404 — '/' excluded from the
  // api prefix so field testers meet a name, never "Cannot GET /".
  app.setGlobalPrefix('api', { exclude: [{ path: '/', method: RequestMethod.GET }] });
  app.enableShutdownHooks();
}
