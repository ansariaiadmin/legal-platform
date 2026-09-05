/**
 * P11 — "not one raw error": DB-outage behavior of auth and the bare-host
 * billboard. These are the two surfaces a field tester meets FIRST.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import * as crypto from 'node:crypto';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';
import { ERROR_CODES } from '@legal-platform/contracts';

describe('P11 Auth dependency honesty', () => {
  function serviceWithDownDb() {
    const deadPool = {
      query: () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })),
      connect: () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    } as unknown as Pool;
    return new AuthService(
      deadPool,
      new (require('@nestjs/jwt').JwtService)({ secret: 's' }),
      new (require('@nestjs/config').ConfigService)({ JWT_ACCESS_SECRET: 's', JWT_REFRESH_SECRET: 'r' }),
      { log: async () => undefined } as never,
      new (require('../../src/common/rate-limit.service').RateLimitService)(),
      { sendSms: async () => ({ success: true }) } as never,
      { sendMail: async () => ({ success: true }) } as never,
    );
  }

  it('OTP request with a dead DB → 503 AUTH_DEPENDENCY_DOWN, never naked 500', async () => {
    const svc = serviceWithDownDb();
    const e = await svc.requestOtp('09121000001', '127.0.0.1').catch((err: Error & { status?: number; message: string }) => err);
    expect(e.status).toBe(503); // ServiceUnavailableException carries 503
    expect(e.message).toBe(ERROR_CODES.AUTH_DEPENDENCY_DOWN);
  });

  it('missing migrations (42P01) → same honest 503 — run migrate:up is the fix, not panic', async () => {
    const svc = new AuthService(
      { query: () => Promise.reject(Object.assign(new Error('relation "otp_challenges" does not exist'), { code: '42P01' })), connect: () => Promise.reject(new Error('x')) } as never,
      new (require('@nestjs/jwt').JwtService)({ secret: 's' }),
      new (require('@nestjs/config').ConfigService)({ JWT_ACCESS_SECRET: 's', JWT_REFRESH_SECRET: 'r' }),
      { log: async () => undefined } as never,
      new (require('../../src/common/rate-limit.service').RateLimitService)(),
      { sendSms: async () => ({ success: true }) } as never,
      { sendMail: async () => ({ success: true }) } as never,
    );
    await expect(svc.requestEmailOtp('vakil@example.com'))
      .rejects.toMatchObject({ message: ERROR_CODES.AUTH_DEPENDENCY_DOWN });
  });

  it('a REAL business error (valid code path, wrong code) is NOT remapped — honesty cuts both ways', async () => {
    const rng = new (require('../../src/common/rate-limit.service').RateLimitService)();
    const pool = {
      query: (sql: string) => sql.includes('FROM otp_challenges')
        ? Promise.resolve({ rows: [{ id: 'c1', code_hash: crypto.createHmac('sha256', 's').update('123456').digest('hex'), attempts: 0, max_attempts: 5, expires_at: new Date(Date.now() + 60_000) }] })
        : Promise.resolve({ rows: [] }),
      connect: () => Promise.reject(new Error('not used')),
    } as unknown as Pool;
    const svc = new AuthService(
      pool,
      new (require('@nestjs/jwt').JwtService)({ secret: 's' }),
      new (require('@nestjs/config').ConfigService)({ JWT_ACCESS_SECRET: 's', JWT_REFRESH_SECRET: 'r' }),
      { log: async () => undefined } as never,
      rng,
      { sendSms: async () => ({ success: true }) } as never,
      { sendMail: async () => ({ success: true }) } as never,
    );
    await expect(svc.verifyOtp('+989121000001', '999999', '127.0.0.1'))
      .rejects.toMatchObject({ message: ERROR_CODES.AUTH_INVALID_CODE });
  });
});

describe('P11 root billboard', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'p11-access-secret';
    process.env.JWT_REFRESH_SECRET = 'p11-refresh-secret';
    process.env.SECURITY_SCAN_INTERVAL_MS = '0';
    process.env.GLOBAL_RATE_LIMIT_PER_MIN = '100000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('GET / answers a name and useful links — never "Cannot GET /"', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.service).toContain('Legal Platform');
    expect(res.body.links.health).toBe('/api/health');
  });

  it('unknown routes still 404 in the structured shape (no HTML stack leaks)', async () => {
    const res = await request(app.getHttpServer()).get('/api/definitely-not-here');
    expect(res.status).toBe(404);
    expect(res.body.success ?? res.body.error?.success).not.toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
  });
});
