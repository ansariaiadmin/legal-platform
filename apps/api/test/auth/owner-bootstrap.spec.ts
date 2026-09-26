/**
 * Owner bootstrap: the account whose phone (OWNER_PHONE) or email
 * (OWNER_EMAIL) is configured receives the lawyer_owner role on sign-in.
 * Every other account stays a client.
 */
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/modules/auth/auth.service';
import { RateLimitService } from '../../src/common/rate-limit.service';
import { UserRole } from '@legal-platform/domain';
import { normalizeIranPhone } from '@legal-platform/shared';
import { MockSmsAdapter } from '../../src/providers/sms/mock-sms.adapter';
import { RoutingSmsProvider } from '../../src/providers/sms/routing-sms.provider';

// The sign-in flow always hands the normalized number to findOrCreateUser.
const phone = (raw: string) => normalizeIranPhone(raw) as string;

class RecordingPool {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  audits: Array<{ action: string }> = [];
  existingUser = false;

  async query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    if (sql.includes('FROM users') && (sql.includes('WHERE phone_normalized') || sql.includes('WHERE email'))) {
      return { rows: this.existingUser ? [{ id: 'user-1', status: 'active' }] : [] };
    }
    if (sql.includes('SELECT id FROM roles')) return { rows: [{ id: 'role-client' }] };
    if (sql.includes('SELECT $1, $2, r.id FROM roles')) return { rows: [], rowCount: 1 };
    if (sql.includes('array_agg')) {
      return { rows: [{ id: 'user-1', phone_normalized: null, email: null, display_name: null, status: 'active', roles: ['client'] }] };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    return { query: (sql: string, params?: unknown[]) => this.query(sql, params), release: () => undefined };
  }

  ownerGrants() {
    return this.queries.filter((q) => q.sql.includes('SELECT $1, $2, r.id FROM roles') && q.params?.[2] === UserRole.LAWYER_OWNER);
  }
}

function makeService(pool: RecordingPool, env: Record<string, string>) {
  const config = new ConfigService({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'r', ...env });
  return new AuthService(
    pool as never,
    new JwtService({ secret: 'a' }),
    config,
    { log: async (e: { action: string }) => void pool.audits.push(e) } as never,
    new RateLimitService(),
    { sendSms: async () => ({ success: true }) } as never,
    { sendEmail: async () => ({ success: true }) } as never,
  );
}

type Internals = {
  findOrCreateUser(phone: string): Promise<unknown>;
  findOrCreateEmailUser(email: string): Promise<unknown>;
};

describe('Owner bootstrap', () => {
  it('grants lawyer_owner to the configured phone, in any input format', async () => {
    const pool = new RecordingPool();
    const svc = makeService(pool, { OWNER_PHONE: '+98 912 123 4567' }) as unknown as Internals;
    await svc.findOrCreateUser(phone('09121234567'));
    expect(pool.ownerGrants()).toHaveLength(1);
    expect(pool.audits.map((a) => a.action)).toContain('owner.bootstrap');
  });

  it('also promotes an existing account that signs in with the configured phone', async () => {
    const pool = new RecordingPool();
    pool.existingUser = true;
    const svc = makeService(pool, { OWNER_PHONE: '09121234567' }) as unknown as Internals;
    await svc.findOrCreateUser(phone('09121234567'));
    expect(pool.ownerGrants()).toHaveLength(1);
  });

  it('leaves every other phone as a client', async () => {
    const pool = new RecordingPool();
    const svc = makeService(pool, { OWNER_PHONE: '09121234567' }) as unknown as Internals;
    await svc.findOrCreateUser(phone('09350000000'));
    expect(pool.ownerGrants()).toHaveLength(0);
    expect(pool.audits).toHaveLength(0);
  });

  it('does nothing when no owner is configured', async () => {
    const pool = new RecordingPool();
    const svc = makeService(pool, {}) as unknown as Internals;
    await svc.findOrCreateUser(phone('09121234567'));
    await svc.findOrCreateEmailUser('owner@example.com');
    expect(pool.ownerGrants()).toHaveLength(0);
  });

  it('grants lawyer_owner to the configured email, case-insensitively', async () => {
    const pool = new RecordingPool();
    const svc = makeService(pool, { OWNER_EMAIL: 'Owner@Example.com' }) as unknown as Internals;
    await svc.findOrCreateEmailUser('owner@example.com');
    expect(pool.ownerGrants()).toHaveLength(1);
  });
});

describe('Owner sign-in before an SMS gateway is configured', () => {
  function serviceWithFailingSms(env: Record<string, string>) {
    const pool = new RecordingPool();
    const config = new ConfigService({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'r', ...env });
    const svc = new AuthService(
      pool as never,
      new JwtService({ secret: 'a' }),
      config,
      { log: async () => undefined } as never,
      new RateLimitService(),
      { sendSms: async () => ({ success: false }) } as never,
      { sendEmail: async () => ({ success: true }) } as never,
    );
    const warnings: string[] = [];
    (svc as unknown as { logger: { warn: (m: string) => void } }).logger = { warn: (m: string) => void warnings.push(m) };
    return { svc, warnings };
  }

  it('prints the code to the server console for the owner only', async () => {
    const { svc, warnings } = serviceWithFailingSms({ OWNER_PHONE: '09121234567' });
    await svc.requestOtp('09121234567');
    expect(warnings.some((w) => /owner sign-in OTP: \d{6}/.test(w))).toBe(true);
  });

  it('never prints the code for anyone else, and tells them the SMS failed', async () => {
    const { svc, warnings } = serviceWithFailingSms({ OWNER_PHONE: '09121234567' });
    await expect(svc.requestOtp('09350000000')).rejects.toMatchObject({ message: 'PROVIDER_UNAVAILABLE' });
    expect(warnings.some((w) => w.includes('one-time code'))).toBe(false);
    expect(warnings.join(' ')).not.toContain('09350000000');
  });
});

describe('Development sign-in code', () => {
  function service(nodeEnv: string, sms: object) {
    return new AuthService(
      new RecordingPool() as never,
      new JwtService({ secret: 'a' }),
      new ConfigService({ NODE_ENV: nodeEnv, JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'r' }),
      { log: async () => undefined } as never,
      new RateLimitService(),
      sms as never,
      { sendEmail: async () => ({ success: true }) } as never,
    );
  }

  it('is returned in development with the mock SMS adapter', async () => {
    const res = await service('development', new MockSmsAdapter()).requestOtp('09121234567');
    expect(res.devCode).toMatch(/^\d{6}$/);
  });

  it('is never returned in production, even with the mock adapter', async () => {
    const res = await service('production', new MockSmsAdapter()).requestOtp('09121234567');
    expect(res.devCode).toBeUndefined();
  });

  it('is never returned with a real gateway', async () => {
    const res = await service('development', { sendSms: async () => ({ success: true }) }).requestOtp('09121234567');
    expect(res.devCode).toBeUndefined();
  });

  it('is returned when the SMS router falls back to the mock adapter (the production wiring)', async () => {
    const router = new RoutingSmsProvider(new MockSmsAdapter(), async () => null);
    const res = await service('development', router).requestOtp('09121234567');
    expect(res.devCode).toMatch(/^\d{6}$/);
  });

  it('is not returned when the router sends through a connected SMS panel', async () => {
    const panel = { sendSms: async () => ({ success: true }), verifyConfig: async () => ({ valid: true }) };
    const router = new RoutingSmsProvider(new MockSmsAdapter(), async () => panel);
    const res = await service('development', router).requestOtp('09121234567');
    expect(res.devCode).toBeUndefined();
  });
});
