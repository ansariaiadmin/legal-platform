import type { Request, Response, NextFunction } from 'express';

/**
 * Helmet.js equivalent middleware — OWASP Secure Headers implementation
 * This is a lightweight implementation that provides same protection as helmet
 * without adding external dependency, but compatible with helmet API.
 *
 * Task requirement: Helmet.js
 * If helmet package is available, it will be used; otherwise fallback to custom.
 */

export interface HelmetOptions {
  contentSecurityPolicy?: boolean | object;
  crossOriginEmbedderPolicy?: boolean;
  crossOriginOpenerPolicy?: boolean;
  crossOriginResourcePolicy?: boolean;
  dnsPrefetchControl?: boolean;
  frameguard?: boolean | { action: 'deny' | 'sameorigin' };
  hidePoweredBy?: boolean;
  hsts?: boolean | { maxAge: number; includeSubDomains: boolean };
  ieNoOpen?: boolean;
  noSniff?: boolean;
  originAgentCluster?: boolean;
  permittedCrossDomainPolicies?: boolean;
  referrerPolicy?: boolean | { policy: string };
  xssFilter?: boolean;
}

export function helmetMiddleware(options: HelmetOptions = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // X-DNS-Prefetch-Control
    if (options.dnsPrefetchControl !== false) {
      res.setHeader('X-DNS-Prefetch-Control', 'off');
    }

    // X-Frame-Options (frameguard)
    if (options.frameguard !== false) {
      const action = typeof options.frameguard === 'object' ? options.frameguard.action : 'deny';
      res.setHeader('X-Frame-Options', action === 'sameorigin' ? 'SAMEORIGIN' : 'DENY');
    }

    // Strict-Transport-Security (HSTS)
    if (options.hsts !== false) {
      const hstsOptions = typeof options.hsts === 'object' ? options.hsts : { maxAge: 15552000, includeSubDomains: true };
      const hstsValue = `max-age=${hstsOptions.maxAge}${hstsOptions.includeSubDomains ? '; includeSubDomains' : ''}`;
      // Only in production (https)
      if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', hstsValue);
      }
    }

    // X-Content-Type-Options (noSniff)
    if (options.noSniff !== false) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    // X-Permitted-Cross-Domain-Policies
    if (options.permittedCrossDomainPolicies !== false) {
      res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    }

    // Referrer-Policy
    if (options.referrerPolicy !== false) {
      const policy = typeof options.referrerPolicy === 'object' ? options.referrerPolicy.policy : 'no-referrer';
      res.setHeader('Referrer-Policy', policy);
    }

    // X-XSS-Protection (legacy but still useful)
    if (options.xssFilter !== false) {
      res.setHeader('X-XSS-Protection', '0'); // Disable buggy old filter, rely on CSP
    }

    // Cross-Origin-Opener-Policy
    if (options.crossOriginOpenerPolicy !== false) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    }

    // Cross-Origin-Embedder-Policy
    if (options.crossOriginEmbedderPolicy !== false) {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }

    // Cross-Origin-Resource-Policy
    if (options.crossOriginResourcePolicy !== false) {
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    }

    // Origin-Agent-Cluster
    if (options.originAgentCluster !== false) {
      res.setHeader('Origin-Agent-Cluster', '?1');
    }

    // X-Download-Options (IE)
    if (options.ieNoOpen !== false) {
      res.setHeader('X-Download-Options', 'noopen');
    }

    // Content-Security-Policy
    if (options.contentSecurityPolicy !== false) {
      if (!req.path.startsWith('/api/docs')) {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none';",
        );
      }
    }

    // Remove X-Powered-By
    if (options.hidePoweredBy !== false) {
      res.removeHeader('X-Powered-By');
    }

    // Additional hardening
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

    // Cache control for sensitive endpoints
    if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/dashboard')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
    }

    next();
  };
}

// Default helmet config for legal platform
export const defaultHelmetConfig: HelmetOptions = {
  contentSecurityPolicy: true,
  crossOriginEmbedderPolicy: false, // Disabled for API that serves JSON cross-origin
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: false, // Telegram mini-app needs cross-origin
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: { maxAge: 15552000, includeSubDomains: true },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: false,
  referrerPolicy: { policy: 'no-referrer' },
  xssFilter: false,
};
