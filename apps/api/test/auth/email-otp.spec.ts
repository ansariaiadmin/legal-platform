/**
 * P10 — Email OTP as an auth factor (owed since P8). Service-level tests
 * drive AuthService with a scripted Pool so OUR logic (validation, rate
 * rules, hashing, outbox, session math) is what is tested — DB integration
 * stays in the e2e suite that CI runs against real Postgres.
 */
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { AuthService } from '../../src/modules/auth/auth.service';
import { RateLimitService } from '../../src/common/rate-limit.service';
import { MockEmailAdapter } from '../../src/providers/email/mock-email.adapter';
import { ERROR_CODES } from '@legal-platform/contracts';
import { normalizeEmail } from '@legal-platform/shared';

class FakePool {
  rows: Record<string, unknown[]> = {};
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  /** challenges keyed by destination for realistic state. */
  challenges = new Map<string, { id: string; code_hash: string; attempts: number; max_attempts: number; expires_at: Date; verified: boolean }>();

  async query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });

    if (sql.includes('INSERT INTO otp_challenges')) {
      const [id, dest, codeHash, , expiresAt] = params as [string, string, string, string, Date];
      this.challenges.set(dest, { id, code_hash: codeHash, attempts: 0, max_attempts: 5, expires_at: expiresAt, verified: false });
      return { rows: [] };
    }
    if (sql.includes('FROM otp_challenges')) {
      const dest = params![0] as string;
      const ch = this.challenges.get(dest);
      return { rows: ch && !ch.verified ? [{ id: ch.id, code_hash: ch.code_hash, attempts: ch.attempts, max_attempts: ch.max_attempts, expires_at: ch.expires_at }] : [] };
    }
    if (sql.includes('SET attempts')) {
      const [attempts, id] = params as [number, string];
      for (const ch of this.challenges.values()) if (ch.id === id) ch.attempts = attempts;
      return { rows: [] };
    }
    if (sql.includes('verified_at = NOW()')) {
      const [id] = params as [string];
      for (const ch of this.challenges.values()) if (ch.id === id) ch.verified = true;
      return { rows: [] };
    }
    if (sql.includes('FROM users') && sql.includes('WHERE email')) {
      return { rows: [] }; // first email login -> create path
    }
    if (sql.includes('FROM users') && sql.includes('WHERE phone_normalized')) {
      return { rows: [] };
    }
    if (sql.includes('FROM roles')) {
      return { rows: [{ id: 'role-client' }] };
    }
    if (/INSERT INTO (users|role_assignments|user_sessions)/i.test(sql)) {
      return { rows: [] };
    }
    if (sql.includes('array_agg')) {
      return { rows: [{ id: 'user-1', phone_normalized: null, email: 'vakil@example.com', display_name: null, status: 'active', roles: ['client'] }] };
    }
    return { rows: [] };
  }

  async connect() {
    return {
      query: (sql: string, params?: unknown[]) => this.query(sql, params),
      release: () => undefined,
    };
  }
}

function makeSvc(pool: FakePool) {
  const email = new MockEmailAdapter();
  const sms = { sendSms: async () => ({ success: true }) };
  const config = new ConfigService({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'acc-secret', JWT_REFRESH_SECRET: 'ref-secret', OTP_TTL_SECONDS: '120' });
  const jwt = new JwtService({ secret: 'acc-secret' });
  const svc = new AuthService(
    pool as never,
    jwt,
    config,
    { log: async () => undefined } as never,
    new RateLimitService(),
    sms as never,
    email,
  );
  return { svc, email };
}

describe('P10 Email OTP — the owed auth factor', () => {
  it('rejects malformed email WITHOUT sending anything (fail-closed input)', async () => {
    const pool = new FakePool();
    const { svc, email } = makeSvc(pool);
    await expect(svc.requestEmailOtp('not-an-email', '127.0.0.1'))
      .rejects.toMatchObject({ message: ERROR_CODES.VALIDATION_INVALID_INPUT });
    expect(email.messagesFor('not-an-email')).toHaveLength(0);
  });

  it('uppercase/spacing normalize to ONE destination (attacker cannot multiply buckets)', () => {
    expect(normalizeEmail('  Vakil@Example.COM ')).toBe('vakil@example.com');
    expect(normalizeEmail('a..b@c.d')).toBeNull();
  });

  it('request → mail leaves the outbox with a 6-digit code; verify happy path mints tokens', async () => {
    const pool = new FakePool();
    const { svc, email } = makeSvc(pool);
    await svc.requestEmailOtp('Vakil@Example.com', '127.0.0.1');
    const mails = email.messagesFor('vakil@example.com');
    expect(mails).toHaveLength(1);
    const code = mails[0].text.match(/\b(\d{6})\b/)![1];
    const tokens = await svc.verifyEmailOtp('vakil@example.com', code, '127.0.0.1');
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.user.email).toBe('vakil@example.com');
    expect(tokens.user.roles).toContain('client');
    // challenge burned — replaying the same code now fails closed
    await expect(svc.verifyEmailOtp('vakil@example.com', code, '127.0.0.1'))
      .rejects.toMatchObject({ message: ERROR_CODES.AUTH_INVALID_CODE });
  });

  it('wrong codes count attempts; max_attempts turns to lockout (429-class), not infinite guessing', async () => {
    const pool = new FakePool();
    const { svc, email } = makeSvc(pool);
    await svc.requestEmailOtp('v2@example.com', '127.0.0.1');
    const realCode = email.messagesFor('v2@example.com')[0].text.match(/\b(\d{6})\b/)![1];
    const wrong = realCode === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i++) {
      await expect(svc.verifyEmailOtp('v2@example.com', wrong)).rejects.toMatchObject({ message: ERROR_CODES.AUTH_INVALID_CODE });
    }
    await expect(svc.verifyEmailOtp('v2@example.com', wrong)).rejects.toMatchObject({ message: ERROR_CODES.AUTH_RATE_LIMITED });
    // even the right code is dead past the lockout
    await expect(svc.verifyEmailOtp('v2@example.com', realCode)).rejects.toMatchObject({ message: ERROR_CODES.AUTH_RATE_LIMITED });
  });

  it('an immediate resend is AUTH_RESEND_COOLDOWN — the anti-spam 60s guard', async () => {
    const pool = new FakePool();
    const { svc } = makeSvc(pool);
    await svc.requestEmailOtp('v3@example.com', '10.0.0.1');
    await expect(svc.requestEmailOtp('v3@example.com', '10.0.0.1'))
      .rejects.toMatchObject({ message: ERROR_CODES.AUTH_RESEND_COOLDOWN });
  });

  it('the per-IP ceiling (20/10min) silences sprayed OTP requests across many emails', async () => {
    const pool = new FakePool();
    const { svc } = makeSvc(pool);
    for (let i = 0; i < 20; i++) {
      await svc.requestEmailOtp(`spray${i}@example.com`, '10.9.9.9');
    }
    await expect(svc.requestEmailOtp('spray21@example.com', '10.9.9.9'))
      .rejects.toMatchObject({ message: ERROR_CODES.AUTH_RATE_LIMITED });
    // ...while a different IP is unscathed (isolation by bucket key)
    await expect(svc.requestEmailOtp('victim@example.com', '10.9.9.8')).resolves.toMatchObject({ challengeId: expect.any(String) });
  });

  it('an expired OTP is AUTH_CODE_EXPIRED, distinguishable from wrong', async () => {
    const pool = new FakePool();
    const { svc, email } = makeSvc(pool);
    await svc.requestEmailOtp('v4@example.com');
    const code = email.messagesFor('v4@example.com')[0].text.match(/\b(\d{6})\b/)![1];
    const ch = pool.challenges.get('v4@example.com')!;
    ch.expires_at = new Date(Date.now() - 1000);
    await expect(svc.verifyEmailOtp('v4@example.com', code))
      .rejects.toMatchObject({ message: ERROR_CODES.AUTH_CODE_EXPIRED });
  });

  it('the code in the DB is an HMAC hash, never plaintext', async () => {
    const pool = new FakePool();
    const { svc, email } = makeSvc(pool);
    await svc.requestEmailOtp('v5@example.com');
    const code = email.messagesFor('v5@example.com')[0].text.match(/\b(\d{6})\b/)![1];
    const ch = pool.challenges.get('v5@example.com')!;
    expect(ch.code_hash).not.toBe(code);
    expect(ch.code_hash).toBe(
      crypto.createHmac('sha256', 'acc-secret').update(code).digest('hex'),
    );
  });
});
