import { Injectable, Logger, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { SmsProvider } from '../../providers/sms/sms.provider';
import { normalizeIranPhone } from '@legal-platform/shared';

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpTtlSeconds = parseInt(process.env.OTP_TTL_SECONDS || '120', 10);
  private readonly rateLimitWindowMs = 10 * 60 * 1000; // 10 minutes
  private readonly maxRateLimitAttempts = 5;
  private readonly resendCooldownMs = 60 * 1000; // 60 seconds
  private readonly bruteForceWindowMs = 15 * 60 * 1000; // 15 minutes
  private readonly maxVerifyAttempts = 5;

  // In-memory rate limiting (production should use Redis)
  private readonly otpRequestLimits = new Map<string, RateLimitEntry>();
  private readonly otpVerifyLimits = new Map<string, RateLimitEntry>();
  private readonly lastOtpSent = new Map<string, number>();

  constructor(
    private readonly pool: Pool,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly smsProvider: SmsProvider,
  ) {}

  async requestOtp(phone: string, ip?: string): Promise<{ challengeId: string }> {
    const normalizedPhone = normalizeIranPhone(phone);
    if (!normalizedPhone) {
      throw new BadRequestException('VALIDATION_INVALID_PHONE');
    }

    // Check rate limit
    const rateLimitKey = normalizedPhone;
    const now = Date.now();
    const existingLimit = this.otpRequestLimits.get(rateLimitKey);

    if (existingLimit) {
      if (existingLimit.lockedUntil && now < existingLimit.lockedUntil) {
        throw new ForbiddenException('AUTH_RATE_LIMITED');
      }
      if (now - existingLimit.firstAttempt < this.rateLimitWindowMs) {
        if (existingLimit.count >= this.maxRateLimitAttempts) {
          const lockedUntil = now + this.rateLimitWindowMs;
          this.otpRequestLimits.set(rateLimitKey, { ...existingLimit, lockedUntil });
          throw new ForbiddenException('AUTH_RATE_LIMITED');
        }
      } else {
        // Reset window
        this.otpRequestLimits.set(rateLimitKey, { count: 0, firstAttempt: now });
      }
    } else {
      this.otpRequestLimits.set(rateLimitKey, { count: 1, firstAttempt: now });
    }

    // Check resend cooldown
    const lastSent = this.lastOtpSent.get(normalizedPhone);
    if (lastSent && now - lastSent < this.resendCooldownMs) {
      throw new ForbiddenException('AUTH_RESEND_COOLDOWN');
    }

    // Generate OTP
    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + this.otpTtlSeconds * 1000);

    // Store challenge
    const result = await this.pool.query(
      `INSERT INTO otp_challenges (destination, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'login', $3)
       RETURNING id`,
      [normalizedPhone, codeHash, expiresAt],
    );

    const challengeId = result.rows[0].id;

    // Send SMS
    const message = `Your verification code: ${code}`;
    const smsResult = await this.smsProvider.sendSms({
      phone: normalizedPhone,
      message,
    });

    if (!smsResult.success) {
      this.logger.warn(`SMS delivery failed for ${normalizedPhone}`);
    }

    // Update rate limit counter
    const currentLimit = this.otpRequestLimits.get(rateLimitKey)!;
    this.otpRequestLimits.set(rateLimitKey, {
      ...currentLimit,
      count: currentLimit.count + 1,
    });
    this.lastOtpSent.set(normalizedPhone, now);

    // Audit log
    await this.auditService.log({
      module: 'auth',
      action: 'otp.request',
      entityType: 'otp_challenge',
      entityId: challengeId,
      metadata: { destination: normalizedPhone, smsSuccess: smsResult.success },
      ip,
      result: 'success',
    });

    return { challengeId };
  }

  async verifyOtp(phone: string, code: string, ip?: string): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const normalizedPhone = normalizeIranPhone(phone);
    if (!normalizedPhone) {
      throw new BadRequestException('VALIDATION_INVALID_PHONE');
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const now = new Date();

    // Find unverified challenge
    const challengeResult = await this.pool.query(
      `SELECT id, code_hash, expires_at, attempts, verified_at 
       FROM otp_challenges 
       WHERE destination = $1 AND code_hash = $2 AND verified_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedPhone, codeHash],
    );

    if (challengeResult.rows.length === 0) {
      // Check if there's any recent challenge to increment attempts
      const anyChallengeResult = await this.pool.query(
        `SELECT id, attempts FROM otp_challenges 
         WHERE destination = $1 AND verified_at IS NULL 
         AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [normalizedPhone],
      );

      if (anyChallengeResult.rows.length > 0) {
        const challenge = anyChallengeResult.rows[0];
        const newAttempts = challenge.attempts + 1;

        await this.pool.query(
          `UPDATE otp_challenges SET attempts = $1 WHERE id = $2`,
          [newAttempts, challenge.id],
        );

        // Check for brute force lock
        if (newAttempts >= this.maxVerifyAttempts) {
          const lockedUntil = Date.now() + this.bruteForceWindowMs;
          this.otpVerifyLimits.set(normalizedPhone, {
            count: newAttempts,
            firstAttempt: Date.now(),
            lockedUntil,
          });
          throw new ForbiddenException('AUTH_RATE_LIMITED');
        }
      }

      await this.auditService.log({
        module: 'auth',
        action: 'otp.verify',
        entityType: 'otp_challenge',
        metadata: { destination: normalizedPhone, reason: 'invalid_code' },
        ip,
        result: 'failure',
      });

      throw new UnauthorizedException('AUTH_INVALID_CODE');
    }

    const challenge = challengeResult.rows[0];

    // Check expiry
    if (new Date(challenge.expires_at) < now) {
      await this.auditService.log({
        module: 'auth',
        action: 'otp.verify',
        entityType: 'otp_challenge',
        entityId: challenge.id,
        metadata: { destination: normalizedPhone, reason: 'expired' },
        ip,
        result: 'failure',
      });
      throw new UnauthorizedException('AUTH_CODE_EXPIRED');
    }

    // Mark as verified
    await this.pool.query(
      `UPDATE otp_challenges SET verified_at = NOW() WHERE id = $1`,
      [challenge.id],
    );

    // Find or create user
    let userResult = await this.pool.query(
      `SELECT id, phone_normalized, email, display_name FROM users 
       WHERE phone_normalized = $1`,
      [normalizedPhone],
    );

    let userId: string;
    if (userResult.rows.length === 0) {
      // Create new user with client role
      const clientRoleResult = await this.pool.query(
        `SELECT id FROM roles WHERE key = 'client'`,
      );
      const roleId = clientRoleResult.rows[0]?.id;

      if (!roleId) {
        throw new Error('Client role not found');
      }

      const newUserResult = await this.pool.query(
        `INSERT INTO users (phone_normalized, status) 
         VALUES ($1, 'active') 
         RETURNING id, phone_normalized, email, display_name`,
        [normalizedPhone],
      );
      userId = newUserResult.rows[0].id;

      await this.pool.query(
        `INSERT INTO role_assignments (user_id, role_id) VALUES ($1, $2)`,
        [userId, roleId],
      );

      userResult = newUserResult;
    } else {
      userId = userResult.rows[0].id;
    }

    // Check brute force lock
    const rateLimitEntry = this.otpVerifyLimits.get(normalizedPhone);
    if (rateLimitEntry && rateLimitEntry.lockedUntil && Date.now() < rateLimitEntry.lockedUntil) {
      throw new ForbiddenException('AUTH_RATE_LIMITED');
    }
    this.otpVerifyLimits.delete(normalizedPhone);

    // Create session and tokens
    const sessionId = crypto.randomUUID();
    const accessToken = this.jwtService.sign(
      { sub: userId, sessionId },
      { expiresIn: '15m' },
    );
    const refreshToken = this.jwtService.sign(
      { sub: userId, sessionId, type: 'refresh' },
      { expiresIn: '7d' },
    );

    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await this.pool.query(
      `INSERT INTO user_sessions (id, user_id, access_token_hash, refresh_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, userId, accessTokenHash, refreshTokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)],
    );

    await this.auditService.log({
      actorId: userId,
      module: 'auth',
      action: 'otp.verify',
      entityType: 'user_session',
      entityId: sessionId,
      metadata: { destination: normalizedPhone },
      ip,
      result: 'success',
    });

    return {
      accessToken,
      refreshToken,
      user: userResult.rows[0],
    };
  }

  async refreshToken(refreshToken: string, ip?: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('AUTH_INVALID_TOKEN');
      }

      const userId = payload.sub;
      const sessionId = payload.sessionId;

      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      // Find and validate session
      const sessionResult = await this.pool.query(
        `SELECT id, user_id, refresh_token_hash, revoked_at, expires_at 
         FROM user_sessions 
         WHERE id = $1 AND access_token_hash IS NOT NULL`,
        [sessionId],
      );

      if (sessionResult.rows.length === 0) {
        throw new UnauthorizedException('AUTH_INVALID_SESSION');
      }

      const session = sessionResult.rows[0];

      if (session.revoked_at) {
        throw new UnauthorizedException('AUTH_SESSION_REVOKED');
      }

      if (new Date(session.expires_at) < new Date()) {
        throw new UnauthorizedException('AUTH_SESSION_EXPIRED');
      }

      if (session.refresh_token_hash !== refreshTokenHash) {
        throw new UnauthorizedException('AUTH_INVALID_TOKEN');
      }

      // Revoke old session
      await this.pool.query(
        `UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1`,
        [sessionId],
      );

      // Create new session
      const newSessionId = crypto.randomUUID();
      const newAccessToken = this.jwtService.sign(
        { sub: userId, sessionId: newSessionId },
        { expiresIn: '15m' },
      );
      const newRefreshToken = this.jwtService.sign(
        { sub: userId, sessionId: newSessionId, type: 'refresh' },
        { expiresIn: '7d' },
      );

      const newAccessTokenHash = crypto.createHash('sha256').update(newAccessToken).digest('hex');
      const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

      await this.pool.query(
        `INSERT INTO user_sessions (id, user_id, access_token_hash, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [newSessionId, userId, newAccessTokenHash, newRefreshTokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)],
      );

      await this.auditService.log({
        actorId: userId,
        module: 'auth',
        action: 'token.refresh',
        entityType: 'user_session',
        entityId: newSessionId,
        ip,
        result: 'success',
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('AUTH_INVALID_TOKEN');
    }
  }

  async logout(sessionId: string, userId: string, ip?: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2`,
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

  async getCurrentUser(userId: string): Promise<any> {
    const userResult = await this.pool.query(
      `SELECT u.id, u.phone_normalized, u.email, u.display_name, u.status,
              array_agg(r.key) as roles
       FROM users u
       LEFT JOIN role_assignments ra ON ra.user_id = u.id
       LEFT JOIN roles r ON r.id = ra.role_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [userId],
    );

    if (userResult.rows.length === 0) {
      throw new UnauthorizedException('AUTH_USER_NOT_FOUND');
    }

    return userResult.rows[0];
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
