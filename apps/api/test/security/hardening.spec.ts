import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';
import { ERROR_CODES } from '@legal-platform/contracts';

/**
 * P6-S1 transport hardening — every assertion is against the REAL
 * configureApp path (same as production boot), not a mock pipeline.
 */
describe('P6-S1 HTTP hardening', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.GLOBAL_RATE_LIMIT_PER_MIN = '100000'; // don't self-DoS the suite
    process.env.SECURITY_SCAN_INTERVAL_MS = '0';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();
  });

  afterAll(async () => {
    delete process.env.GLOBAL_RATE_LIMIT_PER_MIN;
    await app?.close();
  });

  it('security headers ride every response; x-powered-by is gone', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    // dev runtime: HSTS deliberately absent (ADR-021), cookies can't get pinned
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('auth endpoints are cache-poison-proof', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/nope-here').send({});
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('CORS: an evil origin gets NO allow header', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('malformed JSON → 400 envelope, NOT a lying 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dashboard/machine-tokens')
      .set('Content-Type', 'application/json')
      .send('{broken json');
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe(ERROR_CODES.VALIDATION_MALFORMED_JSON);
  });

  it('oversize body → 413 envelope with the honest code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dashboard/machine-tokens')
      .set('Content-Type', 'application/json')
      .send(`{"label":"${'A'.repeat(300 * 1024)}"}`);
    expect(res.status).toBe(413);
    expect(res.body?.error?.code).toBe(ERROR_CODES.VALIDATION_BODY_TOO_LARGE);
  });
});

describe('P6-S1 global rate floor', () => {
  it('the 6th request in a 5/min window is a 429 with Retry-After', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.GLOBAL_RATE_LIMIT_PER_MIN = '5';
    process.env.SECURITY_SCAN_INTERVAL_MS = '0';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();

    try {
      let lastStatus = 0;
      let lastBody: Record<string, unknown> = {};
      let retryAfter: string | undefined;
      for (let i = 0; i < 7; i += 1) {
        const res = await request(app.getHttpServer()).get('/api/health/nope');
        lastStatus = res.status;
        lastBody = res.body;
        retryAfter = res.headers['retry-after'] as string | undefined;
      }
      expect(lastStatus).toBe(429);
      expect((lastBody as { error?: { code?: string } })?.error?.code).toBe(
        ERROR_CODES.SECURITY_RATE_LIMITED,
      );
      expect(Number(retryAfter)).toBeGreaterThan(0);
    } finally {
      delete process.env.GLOBAL_RATE_LIMIT_PER_MIN;
      await app.close();
    }
  });
});
