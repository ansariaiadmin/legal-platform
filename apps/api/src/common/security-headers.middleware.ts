import type { Request, Response, NextFunction } from 'express';

/**
 * HTTP security headers (P6-S1). OWASP Secure Headers / ASVS V14.4 mapping —
 * every header here is deterministic config, so the Security Guardian agent
 * can probe exactly what it asserts (no "we think helmet does this").
 *
 * Deliberate choices, each defended in ADR-021:
 * - HSTS is emitted ONLY in production: sending it over plain-http dev boxes
 *   pins browsers to https that does not exist there.
 * - `Content-Security-Policy` is API-shaped (default-src 'none'; frame-ancestors
 *   'none') — this server renders nothing; the SPA serves its own policy.
 *   Swagger UI (dev only) relaxes itself, applied in main.ts behind the same
 *   flag so production can never accidentally serve the weak policy.
 * - No `Cross-Origin-Resource-Policy`: the Telegram mini-app fetches JSON
 *   cross-origin by design; a same-site CORP would be security theater that
 *   breaks a real client.
 */
export const SECURITY_HEADERS_ENV = 'SECURITY_HEADERS';

export function securityHeadersMiddleware(production: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    // API renders nothing: default-deny everything; docs page overrides in dev.
    if (!req.path.startsWith('/api/docs')) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
    }
    if (production) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    // Auth endpoints must never be cached by shared caches (OTP codes!).
    if (req.path.startsWith('/api/auth')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  };
}
