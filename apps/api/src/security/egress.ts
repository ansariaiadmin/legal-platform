import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * AI EGRESS GUARD (FIELD REVIEW 2026-09-05, finding #3 — SSRF).
 *
 * The platform fetches URLs that office staff configure at runtime (brain
 * endpoints, health probes). Without a border, a compromised OWNER session
 * turns the server into a confused deputy: metadata IP fetch, intranet
 * crawler, and — worse — an exfil relay for privileged office data streamed
 * to "a brain" that is actually the attacker's host.
 *
 * Thesis: LOCAL brains are supposed to live on the office LAN; CLOUD brains
 * are supposed to be public HTTPS endpoints of known vendors. One guard,
 * two postures:
 *
 *  - assertLanUrlAllowed(url)   → local brain lane: http allowed, NO dns trickery allowed; still syntax-verified
 *  - assertPublicEgressAllowed(url, {allowlist}) → cloud/global lane: HTTPS only (prod),
 *    no private/loopback/link-local resolution, optional explicit allowlist
 */

export class EgressDeniedError extends Error {
  readonly code = 'EGRESS_DENIED';
  constructor(message: string) {
    super(message);
    this.name = 'EgressDeniedError';
  }
}

export interface EgressOptions {
  /** comma-separated hostnames, e.g. "openrouter.ai,api.openai.com" */
  allowlist?: string | string[] | undefined;
  /** NODE_ENV — HTTPS is mandatory outside development/test */
  nodeEnv?: string;
}

function normalizeAllowlist(list: EgressOptions['allowlist']): string[] {
  if (!list) return [];
  const items = Array.isArray(list) ? list : list.split(',');
  return items.map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** literal private/reserved hosts, checked WITHOUT DNS first (fast path) */
function isPrivateLiteral(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal') return true;
  // IPv6 forms arrive bracketed in URL.hostname only when the URL had them
  const strippedHost = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
  const ip = isIP(strippedHost);
  if (ip === 4 || ip === 6) return isPrivateIp(strippedHost, ip);
  return false;
}

function isPrivateIp(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // unparseable ⇒ suspicious ⇒ deny
    const [a, b] = parts;
    if (a === 10 || a === 127) return true; // RFC1918 + loopback
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local (cloud metadata lives here)
    if (a === 0) return true;
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  const la = ip.toLowerCase();
  return la === '::1' || la === '::' || la.startsWith('fe80:') || la.startsWith('fc') || la.startsWith('fd');
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressDeniedError('آدرس سرویس معتبر نیست — اتصال قطع شد.');
  }
  if (url.username || url.password) {
    throw new EgressDeniedError('آدرس با credential داخلی مجاز نیست.');
  }
  return url;
}

async function resolvePublicIps(host: string): Promise<string[]> {
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.map((a) => a.address);
  } catch {
    throw new EgressDeniedError(`نام میزبان «${host}» resolve نشد — اتصال قطع شد.`);
  }
}

/**
 * The CLOUD lane: https (outside dev), public resolution only, optional
 * explicit allowlist (AI_EGRESS_ALLOW). Any doubt ⇒ EgressDeniedError.
 */
export async function assertPublicEgressAllowed(rawUrl: string, opts: EgressOptions = {}): Promise<void> {
  const url = parseUrl(rawUrl);
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const allow = normalizeAllowlist(opts.allowlist ?? process.env.AI_EGRESS_ALLOW);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !isProd)) {
    throw new EgressDeniedError('سرویس ابری فقط روی HTTPS مجاز است.');
  }
  if (allow.length > 0 && !allow.includes(url.hostname.toLowerCase())) {
    throw new EgressDeniedError('این میزبان در فهرست خروجی مجاز (AI_EGRESS_ALLOW) نیست.');
  }
  if (isPrivateLiteral(url.hostname)) {
    if (isProd) {
      throw new EgressDeniedError('آدرس سرویس ابری نمی‌تواند به شبکه‌ی داخلی/لوکال اشاره کند.');
    }
    // Dev/test-lab tolerance: adapter contract tests and docker-compose rigs
    // legitimately talk to loopback/LAN (ollama in a sibling container). In
    // production the same URL is a hard SSRF block — posture flips with env.
  } else if (isProd) {
    // DNS-pin check: the hostname must not resolve to a private/internal IP
    // when production traffic flows (guards DNS-rebinding style tricks).
    const ips = await resolvePublicIps(url.hostname);
    if (ips.length === 0) throw new EgressDeniedError(`میزبان «${url.hostname}» آدرس عمومی ندارد.`);
    for (const ip of ips) {
      const fam = isIP(ip);
      if (fam === 0 || isPrivateIp(ip, fam as 4 | 6)) {
        throw new EgressDeniedError('آدرس سرویس به IP داخلی resolve می‌شود — مسدود شد.');
      }
    }
  }
}

/**
 * The LOCAL lane: local brain URLs (LAN intentional by design). Only syntax +
 * protocol sanity is enforced — private IPs are the POINT of this lane.
 */
export function assertLanUrlAllowed(rawUrl: string): void {
  const url = parseUrl(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressDeniedError('پروتکل مغز محلی فقط می‌تواند http/https باشد.');
  }
}
