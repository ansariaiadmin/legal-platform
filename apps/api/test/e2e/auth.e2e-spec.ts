import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';
import { SMS_PROVIDER } from '../../src/providers/provider.tokens';
import type { MockSmsAdapter } from '../../src/providers/sms/mock-sms.adapter';
import { UserRole } from '@legal-platform/domain';

/**
 * End-to-end auth flow against a real PostgreSQL.
 *
 * Skipped when DATABASE_URL is unset - CI provides a pgvector/pgvector:pg16
 * service container and runs the migrations first.
 */
const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn('[e2e] DATABASE_URL is not set - skipping the integration suite');
}

const PHONE = {
  happy: '09121000001',
  wrongCode: '09121000002',
  expired: '09121000003',
  bruteForce: '09121000004',
  roles: '09121000005',
  refreshReuse: '09121000006',
};

const otpCodeFor = async (adapter: MockSmsAdapter, phone: string): Promise<string> => {
  const normalized = `+98${phone.replace(/^0/, '')}`;
  const messages = adapter.messagesFor(normalized);
  const match = messages[0]?.message.match(/\b(\d{6})\b/);
  if (!match) {
    throw new Error(`No OTP captured for ${normalized}`);
  }
  return match[1];
};

describeWithDb('Auth API (integration)', () => {
  let app: INestApplication;
  let pool: Pool;
  let sms: MockSmsAdapter;
  let http: unknown;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();

    http = app.getHttpServer();
    pool = app.get(Pool);
    sms = app.get<MockSmsAdapter>(SMS_PROVIDER);

    await pool.query(
      `TRUNCATE user_sessions, otp_challenges, role_assignments, audit_logs, users RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('reports database and redis status from /api/health', async () => {
    const response = await request(http as never).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.service).toBe('api');
    expect(response.body.checks.database.status).toBe('up');
    // With no REDIS_URL the probe reports `skipped`; the CI job runs a real
    // Redis, so the raw RESP client must see it there.
    expect(response.body.checks.redis.status).toBe(process.env.REDIS_URL ? 'up' : 'skipped');
    expect(response.body.status).toBe('ok');
  });

  it('rejects a malformed phone number with a structured error', async () => {
    const response = await request(http as never)
      .post('/api/auth/otp/request')
      .send({ phone: '12345' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_INVALID_PHONE' },
    });
  });

  it('runs the full login lifecycle: request -> verify -> me -> refresh -> logout', async () => {
    const challenge = await request(http as never)
      .post('/api/auth/otp/request')
      .send({ phone: PHONE.happy });

    expect(challenge.status).toBe(201);
    expect(challenge.body.challengeId).toEqual(expect.any(String));

    const code = await otpCodeFor(sms, PHONE.happy);

    const verify = await request(http as never)
      .post('/api/auth/otp/verify')
      .send({ phone: PHONE.happy, code });

    expect(verify.status).toBe(200);
    expect(verify.body.accessToken).toEqual(expect.any(String));
    expect(verify.body.refreshToken).toEqual(expect.any(String));
    expect(verify.body.user.roles).toContain(UserRole.CLIENT);
    expect(verify.body.user.phoneNormalized).toBe('+989121000001');

    // Regression: the guard used to expose the raw JWT payload, so `user.id`
    // was undefined and /auth/me always returned AUTH_USER_NOT_FOUND.
    const me = await request(http as never)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${verify.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.id).toBe(verify.body.user.id);
    expect(me.body.roles).toContain(UserRole.CLIENT);

    const refreshed = await request(http as never)
      .post('/api/auth/refresh')
      .send({ refreshToken: verify.body.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).not.toBe(verify.body.accessToken);

    // The rotated-away refresh token must not be replayable.
    const replay = await request(http as never)
      .post('/api/auth/refresh')
      .send({ refreshToken: verify.body.refreshToken });

    expect(replay.status).toBe(401);

    const logout = await request(http as never)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);

    expect(logout.status).toBe(200);

    // Regression: logout used to be ineffective until the access token expired.
    const afterLogout = await request(http as never)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);

    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error.code).toBe('AUTH_SESSION_REVOKED');
  });

  it('rejects a wrong OTP code', async () => {
    await request(http as never).post('/api/auth/otp/request').send({ phone: PHONE.wrongCode });

    const response = await request(http as never)
      .post('/api/auth/otp/verify')
      .send({ phone: PHONE.wrongCode, code: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_INVALID_CODE');
  });

  it('rejects an expired challenge', async () => {
    await request(http as never).post('/api/auth/otp/request').send({ phone: PHONE.expired });

    await pool.query(`UPDATE otp_challenges SET expires_at = NOW() - INTERVAL '1 hour' WHERE destination = $1`, [
      '+989121000003',
    ]);

    const code = await otpCodeFor(sms, PHONE.expired);
    const response = await request(http as never)
      .post('/api/auth/otp/verify')
      .send({ phone: PHONE.expired, code });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_CODE_EXPIRED');
  });

  it('locks the destination after the allowed number of wrong attempts', async () => {
    await request(http as never).post('/api/auth/otp/request').send({ phone: PHONE.bruteForce });

    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(http as never)
        .post('/api/auth/otp/verify')
        .send({ phone: PHONE.bruteForce, code: '111111' });
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });

  it('refuses an unauthenticated call to a dashboard route', async () => {
    const response = await request(http as never).get('/api/dashboard/providers');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_MISSING_TOKEN');
  });

  it('enforces roles: a client cannot read provider settings, an owner can', async () => {
    await request(http as never).post('/api/auth/otp/request').send({ phone: PHONE.roles });
    const code = await otpCodeFor(sms, PHONE.roles);

    const verify = await request(http as never)
      .post('/api/auth/otp/verify')
      .send({ phone: PHONE.roles, code });

    const asClient = await request(http as never)
      .get('/api/dashboard/providers')
      .set('Authorization', `Bearer ${verify.body.accessToken}`);

    expect(asClient.status).toBe(403);
    expect(asClient.body.error.code).toBe('AUTH_INSUFFICIENT_ROLE');

    await pool.query(
      `INSERT INTO role_assignments (id, user_id, role_id)
       SELECT gen_random_uuid(), $1, id FROM roles WHERE key = $2
       ON CONFLICT DO NOTHING`,
      [verify.body.user.id, UserRole.LAWYER_OWNER],
    );

    // Roles are a token claim, so a new session is required for the change to apply.
    const refreshed = await request(http as never)
      .post('/api/auth/refresh')
      .send({ refreshToken: verify.body.refreshToken });

    const asOwner = await request(http as never)
      .get('/api/dashboard/providers')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);

    expect(asOwner.status).toBe(200);
    expect(Array.isArray(asOwner.body)).toBe(true);
  });

  /**
   * Regression: `audit_logs.id` had no default and AuditService swallowed the
   * resulting NOT NULL violation, so the audit trail was silently empty.
   */
  it('actually writes rows to the audit trail', async () => {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs`,
    );

    expect(Number(result.rows[0].count)).toBeGreaterThan(0);

    const actions = await pool.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_logs`,
    );
    const recorded = actions.rows.map((row) => row.action);

    expect(recorded).toEqual(expect.arrayContaining(['otp.request', 'otp.verify', 'logout']));
  });
});
