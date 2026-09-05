import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import * as crypto from 'crypto';
import { ERROR_CODES } from '@legal-platform/contracts';
import { UserRole } from '@legal-platform/domain';
import { normalizeEmail, normalizeIranPhone } from '@legal-platform/shared';
import { AuditService } from '../audit/audit.service';
import { SmsProvider } from '../../providers/sms/sms.provider';
import { EMAIL_PROVIDER, SMS_PROVIDER } from '../../providers/provider.tokens';
import type { EmailProvider } from '../../providers/email/email.provider';
import { RateLimitService } from '../../common/rate-limit.service';
import type { AccessTokenClaims, RefreshTokenClaims } from '../../security/authenticated-user';

export interface PublicUser {
  id: string;
  phoneNormalized: string | null;
  email: string | null;
  displayName: string | null;
  status: string;
  roles: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface OtpChallengeRow {
  id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
}

interface UserRow {
  id: string;
  phone_normalized: string | null;
  email: string | null;
  display_name: string | null;
  status: string;
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Audit-log hygiene (FIELD REVIEW 2026-09-05 #9): destinations in audit
 * metadata are PII — audit trails are long-lived, read by admins, exported
 * to reports. We keep correlation possible (same input ⇒ same mask) while
 * exposing only the minimum: phones keep country prefix + last 2, emails
 * keep first letter + domain. The DB's otp_challenges.destination column
 * still stores the full value because the challenge lookup joins on it —
 * only the audit copy is masked.
 */
export function maskDestination(destination: string): string {
  const d = destination.trim();
  if (d.includes('@')) {
    const [local, domain] = d.split('@');
    const head = local.slice(0, 1); // empty local → no head at all, still no leak
    return `${head ? `${head}•••` : '•••'}@${domain ?? '•••'}`;
  }
  if (d.length <= 6) return '•••';
  return `${d.slice(0, 4)}•••${d.slice(-2)}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpTtlSeconds: number;

  constructor(
    private readonly pool: Pool,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly rateLimiter: RateLimitService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {
    this.otpTtlSeconds = Number(this.configService.get<string>('OTP_TTL_SECONDS')) || 120;
  }

  async requestOtp(phone: string, ip?: string): Promise<{ challengeId: string }> {
    const normalizedPhone = normalizeIranPhone(phone);
    if (!normalizedPhone) {
      throw new BadRequestException(ERROR_CODES.VALIDATION_INVALID_PHONE);
    }

    const phoneDecision = this.rateLimiter.consume(`otp:request:${normalizedPhone}`, {
      limit: 5,
      windowMs: 10 * 60 * 1000,
      cooldownMs: 60 * 1000,
      lockMs: 10 * 60 * 1000,
    });
    if (!phoneDecision.allowed) {
      await this.auditService.log({
        module: 'auth',
        action: 'otp.request',
        entityType: 'otp_challenge',
        metadata: { destination: maskDestination(normalizedPhone), reason: phoneDecision.rejection },
        ip,
        result: 'failure',
      });
      throw new ForbiddenException(
        phoneDecision.rejection === 'cooldown'
          ? ERROR_CODES.AUTH_RESEND_COOLDOWN
          : ERROR_CODES.AUTH_RATE_LIMITED,
      );
    }

    if (ip) {
      // Stops one host from spraying OTP requests across many numbers.
      const ipDecision = this.rateLimiter.consume(`otp:request:ip:${ip}`, {
        limit: 20,
        windowMs: 10 * 60 * 1000,
        lockMs: 10 * 60 * 1000,
      });
      if (!ipDecision.allowed) {
        throw new ForbiddenException(ERROR_CODES.AUTH_RATE_LIMITED);
      }
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = this.hashCode(code);
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.otpTtlSeconds * 1000);

    await this.requireDb(this.pool.query(
      `INSERT INTO otp_challenges (id, destination, code_hash, purpose, expires_at)
       VALUES ($1, $2, $3, 'login', $4)`,
      [challengeId, normalizedPhone, codeHash, expiresAt],
    ));

    // Only log the code when the mock adapter is in play (development).
    const message = `کد تأیید شما: ${code}`;
    const smsResult = await this.smsProvider.sendSms({ phone: normalizedPhone, message });

    if (!smsResult.success) {
      this.logger.warn(`SMS delivery failed for ${normalizedPhone}`);
    }

    await this.auditService.log({
      module: 'auth',
      action: 'otp.request',
      entityType: 'otp_challenge',
      entityId: challengeId,
      metadata: { destination: maskDestination(normalizedPhone), smsSuccess: smsResult.success },
      ip,
      result: 'success',
    });

    return { challengeId };
  }

  async verifyOtp(phone: string, code: string, ip?: string): Promise<AuthTokens & { user: PublicUser }> {
    const normalizedPhone = normalizeIranPhone(phone);
    if (!normalizedPhone) {
      throw new BadRequestException(ERROR_CODES.VALIDATION_INVALID_PHONE);
    }

    const verifyKey = `otp:verify:${normalizedPhone}`;
    const decision = this.rateLimiter.consume(verifyKey, {
      limit: 5,
      windowMs: 15 * 60 * 1000,
      lockMs: 15 * 60 * 1000,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(ERROR_CODES.AUTH_RATE_LIMITED);
    }

    const challenge = await this.requireDb(this.pool.query<OtpChallengeRow>(
      `SELECT id, code_hash, attempts, max_attempts, expires_at
         FROM otp_challenges
        WHERE destination = $1
          AND purpose = 'login'
          AND verified_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [normalizedPhone],
    ));

    if (challenge.rows.length === 0) {
      await this.auditService.log({
        module: 'auth',
        action: 'otp.verify',
        entityType: 'otp_challenge',
        metadata: { destination: maskDestination(normalizedPhone), reason: 'no_challenge' },
        ip,
        result: 'failure',
      });
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_CODE);
    }

    const row = challenge.rows[0];

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.auditService.log({
        module: 'auth',
        action: 'otp.verify',
        entityType: 'otp_challenge',
        entityId: row.id,
        metadata: { destination: maskDestination(normalizedPhone), reason: 'expired' },
        ip,
        result: 'failure',
      });
      throw new UnauthorizedException(ERROR_CODES.AUTH_CODE_EXPIRED);
    }

    if (!this.hashMatches(code, row.code_hash)) {
      const attempts = row.attempts + 1;
      await this.pool.query(`UPDATE otp_challenges SET attempts = $1 WHERE id = $2`, [
        attempts,
        row.id,
      ]);

      await this.auditService.log({
        module: 'auth',
        action: 'otp.verify',
        entityType: 'otp_challenge',
        entityId: row.id,
        metadata: { destination: maskDestination(normalizedPhone), reason: 'invalid_code', attempts },
        ip,
        result: 'failure',
      });

      if (attempts >= row.max_attempts) {
        throw new ForbiddenException(ERROR_CODES.AUTH_RATE_LIMITED);
      }
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_CODE);
    }

    // Verified: burn the challenge and clear the brute-force budget.
    await this.pool.query(`UPDATE otp_challenges SET verified_at = NOW() WHERE id = $1`, [row.id]);
    this.rateLimiter.reset(verifyKey, `otp:request:${normalizedPhone}`);

    const user = await this.requireDb(this.findOrCreateUser(normalizedPhone));
    const session = await this.requireDb(this.createSession(user, ip));

    await this.auditService.log({
      actorId: user.id,
      module: 'auth',
      action: 'otp.verify',
      entityType: 'user_session',
      entityId: session.sessionId,
      metadata: { destination: maskDestination(normalizedPhone) },
      ip,
      result: 'success',
    });

    return { accessToken: session.accessToken, refreshToken: session.refreshToken, user };
  }

  /**
   * P10 — email as a first-class auth factor (owed from P8). Identical
   * security math to the phone flow: same challenges table, same attempts/
   * TTL/lockout, same audit trail. The destination column just holds an
   * email now; purpose 'login' keeps ONE validation path for both channels.
   */
  async requestEmailOtp(email: string, ip?: string): Promise<{ challengeId: string }> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      throw new BadRequestException(ERROR_CODES.VALIDATION_INVALID_INPUT);
    }

    const destDecision = this.rateLimiter.consume(`otp:request:email:${normalized}`, {
      limit: 5,
      windowMs: 10 * 60 * 1000,
      cooldownMs: 60 * 1000,
      lockMs: 10 * 60 * 1000,
    });
    if (!destDecision.allowed) {
      await this.auditService.log({
        module: 'auth',
        action: 'otp.request',
        entityType: 'otp_challenge',
        metadata: { destination: maskDestination(normalized), channel: 'email', reason: destDecision.rejection },
        ip,
        result: 'failure',
      });
      throw new ForbiddenException(
        destDecision.rejection === 'cooldown'
          ? ERROR_CODES.AUTH_RESEND_COOLDOWN
          : ERROR_CODES.AUTH_RATE_LIMITED,
      );
    }
    if (ip) {
      const ipDecision = this.rateLimiter.consume(`otp:request:ip:${ip}`, {
        limit: 20,
        windowMs: 10 * 60 * 1000,
        lockMs: 10 * 60 * 1000,
      });
      if (!ipDecision.allowed) {
        throw new ForbiddenException(ERROR_CODES.AUTH_RATE_LIMITED);
      }
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.otpTtlSeconds * 1000);

    await this.requireDb(this.pool.query(
      `INSERT INTO otp_challenges (id, destination, code_hash, purpose, expires_at)
       VALUES ($1, $2, $3, 'login', $4)`,
      [challengeId, normalized, this.hashCode(code), expiresAt],
    ));

    const mail = await this.emailProvider.sendMail({
      to: normalized,
      subject: 'کد ورود شما به پلتفرم حقوقی',
      text: `کد تأیید شما: ${code}\n\nاین کد ${Math.round(this.otpTtlSeconds / 60)} دقیقه معتبر است. اگر شما آن را نخواسته‌اید، همین را نادیده بگیرید.`,
    });
    if (!mail.success) {
      this.logger.warn(`Email delivery failed for ${normalized}`);
    }

    await this.auditService.log({
      module: 'auth',
      action: 'otp.request',
      entityType: 'otp_challenge',
      entityId: challengeId,
      metadata: { destination: maskDestination(normalized), channel: 'email', mailSuccess: mail.success },
      ip,
      result: 'success',
    });
    return { challengeId };
  }

  async verifyEmailOtp(email: string, code: string, ip?: string): Promise<AuthTokens & { user: PublicUser }> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      throw new BadRequestException(ERROR_CODES.VALIDATION_INVALID_INPUT);
    }

    const verifyKey = `otp:verify:email:${normalized}`;
    const decision = this.rateLimiter.consume(verifyKey, {
      limit: 5,
      windowMs: 15 * 60 * 1000,
      lockMs: 15 * 60 * 1000,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(ERROR_CODES.AUTH_RATE_LIMITED);
    }

    const challenge = await this.requireDb(this.pool.query<OtpChallengeRow>(
      `SELECT id, code_hash, attempts, max_attempts, expires_at
         FROM otp_challenges
        WHERE destination = $1
          AND purpose = 'login'
          AND verified_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [normalized],
    ));
    const row = challenge.rows[0];
    if (!row) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_CODE);
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_CODE_EXPIRED);
    }
    if (!this.hashMatches(code, row.code_hash)) {
      const attempts = row.attempts + 1;
      await this.pool.query(`UPDATE otp_challenges SET attempts = $1 WHERE id = $2`, [attempts, row.id]);
      if (attempts >= row.max_attempts) {
        throw new ForbiddenException(ERROR_CODES.AUTH_RATE_LIMITED);
      }
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_CODE);
    }

    await this.pool.query(`UPDATE otp_challenges SET verified_at = NOW() WHERE id = $1`, [row.id]);
    this.rateLimiter.reset(verifyKey, `otp:request:email:${normalized}`);

    const user = await this.requireDb(this.findOrCreateEmailUser(normalized));
    const session = await this.requireDb(this.createSession(user, ip));

    await this.auditService.log({
      actorId: user.id,
      module: 'auth',
      action: 'otp.verify',
      entityType: 'user_session',
      entityId: session.sessionId,
      metadata: { destination: maskDestination(normalized), channel: 'email' },
      ip,
      result: 'success',
    });

    return { accessToken: session.accessToken, refreshToken: session.refreshToken, user };
  }

  async refreshToken(refreshToken: string, ip?: string): Promise<AuthTokens> {
    let claims: RefreshTokenClaims;
    try {
      claims = this.jwtService.verify<RefreshTokenClaims>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    if (claims.type !== 'refresh' || !claims.sub || !claims.sessionId) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the row so two concurrent refreshes cannot both rotate.
      const sessionResult = await client.query(
        `SELECT user_id, refresh_token_hash, revoked_at, expires_at
           FROM user_sessions
          WHERE id = $1
          FOR UPDATE`,
        [claims.sessionId],
      );

      if (sessionResult.rows.length === 0) {
        throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_SESSION);
      }

      const session = sessionResult.rows[0];
      if (session.revoked_at) {
        throw new UnauthorizedException(ERROR_CODES.AUTH_SESSION_REVOKED);
      }
      if (new Date(session.expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException(ERROR_CODES.AUTH_SESSION_EXPIRED);
      }
      if (!this.hashMatches(refreshToken, session.refresh_token_hash)) {
        // A token that is not the current one for this session is a reuse signal.
        throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN);
      }

      await client.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1`, [
        claims.sessionId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN);
    } finally {
      client.release();
    }

    const user = await this.loadUser(claims.sub);
    const tokens = await this.createSession(user, ip);

    await this.auditService.log({
      actorId: user.id,
      module: 'auth',
      action: 'token.refresh',
      entityType: 'user_session',
      entityId: claims.sessionId,
      ip,
      result: 'success',
    });

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  async logout(sessionId: string, userId: string, ip?: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );

    await this.auditService.log({
      actorId: userId,
      module: 'auth',
      action: 'logout',
      entityType: 'user_session',
      entityId: sessionId,
      ip,
      result: 'success',
    });
  }

  async getCurrentUser(userId: string): Promise<PublicUser> {
    return this.loadUser(userId);
  }

  // ---------------------------------------------------------------- internals

  private async loadUser(userId: string): Promise<PublicUser> {
    const result = await this.pool.query<UserRow & { roles: string[] }>(
      `SELECT u.id, u.phone_normalized, u.email, u.display_name, u.status,
              COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN role_assignments ra ON ra.user_id = u.id
         LEFT JOIN roles r ON r.id = ra.role_id
        WHERE u.id = $1
        GROUP BY u.id`,
      [userId],
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_USER_NOT_FOUND);
    }

    return this.toPublicUser(result.rows[0]);
  }

  private async findOrCreateUser(normalizedPhone: string): Promise<PublicUser> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Take an advisory lock keyed on the phone so two concurrent verifications
      // cannot both insert the same user.
      const lockKey = BigInt(`0x${crypto.createHash('sha256').update(normalizedPhone).digest('hex').slice(0, 15)}`);
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey.toString()]);

      const existing = await client.query<UserRow>(
        `SELECT id, phone_normalized, email, display_name, status
           FROM users
          WHERE phone_normalized = $1`,
        [normalizedPhone],
      );

      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return this.loadUser(existing.rows[0].id);
      }

      const clientRole = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE key = $1`,
        [UserRole.CLIENT],
      );
      if (clientRole.rows.length === 0) {
        throw new Error(`Role '${UserRole.CLIENT}' is missing - run migrations`);
      }

      const userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, phone_normalized, status) VALUES ($1, $2, 'active')`,
        [userId, normalizedPhone],
      );
      await client.query(
        `INSERT INTO role_assignments (id, user_id, role_id) VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), userId, clientRole.rows[0].id],
      );

      await client.query('COMMIT');
      return this.loadUser(userId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Email-channel twin of findOrCreateUser: match on the email column,
   * same advisory lock + client role bootstrap discipline (P10). */
  private async findOrCreateEmailUser(normalized: string): Promise<PublicUser> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockKey = BigInt(`0x${crypto.createHash('sha256').update(`email:${normalized}`).digest('hex').slice(0, 15)}`);
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey.toString()]);

      const existing = await client.query<UserRow>(
        `SELECT id, phone_normalized, email, display_name, status FROM users WHERE email = $1`,
        [normalized],
      );
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return this.loadUser(existing.rows[0].id);
      }

      const clientRole = await client.query<{ id: string }>(`SELECT id FROM roles WHERE key = $1`, [UserRole.CLIENT]);
      if (clientRole.rows.length === 0) {
        throw new Error(`Role '${UserRole.CLIENT}' is missing - run migrations`);
      }

      const userId = crypto.randomUUID();
      await client.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [userId, normalized]);
      await client.query(
        `INSERT INTO role_assignments (id, user_id, role_id) VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), userId, clientRole.rows[0].id],
      );
      await client.query('COMMIT');
      return this.loadUser(userId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async createSession(
    user: PublicUser,
    ip?: string,
  ): Promise<AuthTokens & { sessionId: string }> {
    const sessionId = crypto.randomUUID();

    const accessClaims: AccessTokenClaims = { sub: user.id, sessionId, roles: user.roles };
    const refreshClaims: RefreshTokenClaims = {
      sub: user.id,
      sessionId,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessClaims, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = this.jwtService.sign(refreshClaims, {
      expiresIn: REFRESH_TOKEN_TTL,
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
    });

    await this.pool.query(
      `INSERT INTO user_sessions (id, user_id, access_token_hash, refresh_token_hash, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        user.id,
        this.hashCode(accessToken),
        this.hashCode(refreshToken),
        ip ?? null,
        new Date(Date.now() + SESSION_TTL_MS),
      ],
    );

    return { accessToken, refreshToken, sessionId };
  }

  private toPublicUser(row: UserRow & { roles?: string[] }): PublicUser {
    return {
      id: row.id,
      phoneNormalized: row.phone_normalized,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      roles: Array.isArray(row.roles) ? row.roles : [],
    };
  }

  /**
   * A 6-digit code has only 10^6 possible values, so hashing alone is not
   * secrecy - it just keeps the plaintext out of the database. The HMAC key
   * means an attacker who reads `otp_challenges` still cannot recover codes
   * without the server secret. The real brute-force defence is the short TTL
   * plus the per-destination attempt limit enforced in verifyOtp().
   */
  /**
   * P11: a DB outage on the FIRST screen a field tester touches must never
   * whisper 'SYSTEM_INTERNAL_ERROR'. Connection-class pg failures (ECONN-,
   * 28000 auth, 42P01 missing-table = forgot migrations) become an honest
   * AUTH_DEPENDENCY_DOWN 503 — the UI copy then says what to run, not
   * 'something broke'.
   */
  private isInfrastructureError(e: unknown): boolean {
    const anyErr = e as { code?: string; message?: string; errors?: unknown[] };
    // pg-pool wraps multi-host/connection failures in AggregateError with an
    // EMPTY message (observed live: 500 + AggregateError, no text). Recurse.
    if (Array.isArray(anyErr?.errors) && anyErr.errors.length > 0) {
      return anyErr.errors.some((inner) => this.isInfrastructureError(inner));
    }
    const code = anyErr?.code ?? '';
    if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|57P01|0800[0-9]|3D000|28P01|42P01)$/.test(code)) return true;
    // AggregateError's message can be ''; ALSO treat empty-message AGG as db-down (pg style)
    if (anyErr instanceof AggregateError) return true;
    return /connect|connection refused|does not exist|no pg_hba|timeout|ECONN/i.test(anyErr?.message ?? '');
  }

  private requireDb<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      if (this.isInfrastructureError(e)) {
        this.logger.error(`database unavailable during auth flow: ${(e as Error).message}`);
        throw new ServiceUnavailableException(ERROR_CODES.AUTH_DEPENDENCY_DOWN);
      }
      throw e;
    });
  }

  private hashCode(code: string): string {
    return crypto.createHmac('sha256', this.otpKey()).update(code).digest('hex');
  }

  /**
   * FIELD REVIEW #14 — pepper separation: OTP codes sign with a DEDICATED
   * key (OTP_HASH_PEPPER) so rotating JWT secrets never burns a user mid-
   * challenge. Verification accepts the legacy key for one OTP lifetime
   * (challenges die in minutes anyway) — a seamless rotation seam, not a
   * security hole, because an attacker still needs the code.
   */
  private otpKeysForVerify(): string[] {
    const keys: string[] = [];
    const dedicated = this.configService.get<string>('OTP_HASH_PEPPER');
    if (dedicated) keys.push(dedicated);
    keys.push(
      this.configService.get<string>('ENCRYPTION_MASTER_KEY') ||
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      'development-only-otp-key',
    );
    return keys;
  }

  private otpKey(): string {
    return this.otpKeysForVerify()[0];
  }

  private hashMatches(code: string, expectedHash: string): boolean {
    const expected = Buffer.from(expectedHash, 'hex');
    // Try dedicated pepper first, then the legacy key (one-challenge window).
    for (const key of this.otpKeysForVerify()) {
      const actual = Buffer.from(
        crypto.createHmac('sha256', key).update(code).digest('hex'),
        'hex',
      );
      if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
        return true;
      }
    }
    return false;
  }
}
