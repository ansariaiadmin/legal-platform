import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { ERROR_CODES } from '@legal-platform/contracts';
import { redeemStreamTicket } from './stream-tickets';
import type { AuthenticatedUser, AccessTokenClaims } from './authenticated-user';

/**
 * Verifies the bearer access token AND confirms the backing session is still
 * alive, so that logout / session invalidation takes effect immediately
 * instead of after the access token expires (SPEC section 10).
 */
@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      query?: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const authHeader = request.headers.authorization;

    // -- stream ticket lane (FIELD REVIEW 2026-09-05 #4) --------------------
    // EventSource cannot send Authorization, so SSE callers redeem a
    // SINGLE-USE 45-second ticket (?ticket=) instead of smuggling the real
    // JWT through the URL. A ticket in a log buys nothing; the bearer path
    // below stays untouched for everything else.
    const rawTicket = request.query?.ticket;
    if (typeof rawTicket === 'string' && rawTicket.length > 0) {
      return this.authenticateViaStreamTicket(rawTicket, request);
    }

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_MISSING_TOKEN);
    }

    const token = authHeader.substring('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_MISSING_TOKEN);
    }

    // -- sandbox door (ADR-014) ---------------------------------------------
    // Exactly one convenience: when the deployer EXPLICITLY exports
    // DEV_DASHBOARD_TOKEN outside production, a bearer equal to that secret
    // maps to a fixed dev owner so the dashboard can be exercised where no
    // Postgres/Redis exists (e.g. online sandboxes). In production the check
    // short-circuits BEFORE the comparison — the env var alone does nothing.
    const devToken = this.configService.get<string>('DEV_DASHBOARD_TOKEN');
    const isProd = (this.configService.get<string>('NODE_ENV') ?? 'development') === 'production';
    if (!isProd && devToken && token === devToken) {
      request.user = {
        id: 'dev-owner',
        sessionId: 'dev-session',
        roles: ['lawyer_owner'],
      };
      return true;
    }

    let claims: AccessTokenClaims;
    try {
      claims = this.jwtService.verify<AccessTokenClaims>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    if (!claims.sub || !claims.sessionId) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    await this.assertLiveSession(claims.sub, claims.sessionId);

    request.user = {
      id: claims.sub,
      sessionId: claims.sessionId,
      roles: Array.isArray(claims.roles) ? claims.roles : [],
    };

    return true;
  }

  /**
   * Redeem a single-use stream ticket, then subject its claims to the SAME
   * live-session database check the bearer path enforces — a ticket must
   * never outlive a revoked session.
   */
  private async authenticateViaStreamTicket(
    ticket: string,
    request: { user?: AuthenticatedUser },
  ): Promise<boolean> {
    const claims = redeemStreamTicket(ticket);
    if (!claims) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN);
    }
    // The sandbox dev-door ticket (minted under DEV_DASHBOARD_TOKEN with the
    // sentinel session) skips the DB session check — exactly like the bearer
    // dev-door — and only ever outside production.
    const devToken = this.configService.get<string>('DEV_DASHBOARD_TOKEN');
    const isProd = (this.configService.get<string>('NODE_ENV') ?? 'development') === 'production';
    const isDevDoorTicket = !isProd && !!devToken && claims.sub === 'dev-owner' && claims.sessionId === 'dev-session';
    if (!isDevDoorTicket) {
      await this.assertLiveSession(claims.sub, claims.sessionId);
    }
    request.user = {
      id: claims.sub,
      sessionId: claims.sessionId,
      roles: Array.isArray(claims.roles) ? claims.roles : [],
    };
    return true;
  }

  private async assertLiveSession(sub: string, sessionId: string): Promise<void> {
    const session = await this.pool.query(
      `SELECT revoked_at, expires_at
         FROM user_sessions
        WHERE id = $1 AND user_id = $2`,
      [sessionId, sub],
    );

    if (session.rows.length === 0) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_INVALID_SESSION);
    }

    const row = session.rows[0] as { revoked_at: Date | null; expires_at: Date };
    if (row.revoked_at) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_SESSION_REVOKED);
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_SESSION_EXPIRED);
    }
  }
}
