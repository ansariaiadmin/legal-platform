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
      user?: AuthenticatedUser;
    }>();

    const authHeader = request.headers.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_MISSING_TOKEN);
    }

    const token = authHeader.substring('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException(ERROR_CODES.AUTH_MISSING_TOKEN);
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

    const session = await this.pool.query(
      `SELECT revoked_at, expires_at
         FROM user_sessions
        WHERE id = $1 AND user_id = $2`,
      [claims.sessionId, claims.sub],
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

    request.user = {
      id: claims.sub,
      sessionId: claims.sessionId,
      roles: Array.isArray(claims.roles) ? claims.roles : [],
    };

    return true;
  }
}
