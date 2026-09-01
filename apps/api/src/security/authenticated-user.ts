/**
 * Shape placed on `request.user` by JwtAccessGuard.
 *
 * Note this is NOT the raw JWT payload: the token carries `sub`, while every
 * controller and service in this codebase reads `user.id`. The guard performs
 * that mapping once, here.
 */
export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  roles: string[];
}

export interface AccessTokenClaims {
  sub: string;
  sessionId: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

export interface RefreshTokenClaims {
  sub: string;
  sessionId: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}
