import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * STREAM TICKETS (FIELD REVIEW 2026-09-05, finding #4 — credential in URL).
 *
 * Browsers cannot set Authorization on EventSource, so the first iteration
 * passed the 60-minute JWT in ?token=. A long-lived bearer in a URL bleeds
 * into proxy logs, history, referers. Tickets replace that with a
 * SINGLE-USE, 45-second credential: even a logged ticket buys nothing by
 * the time an attacker reads it.
 *
 * Format: base64url(JSON payload) + '.' + HMAC-SHA256(payload, secret).
 * Stateless to verify; the CONSUMED set enforces single-use in-process
 * (multi-replica: ticket issued on A, redeemed on B works ONCE per process —
 * acceptable for 45s windows; a Redis-backed swap is the scale-out path).
 */

const TTL_MS = 45_000;
const SECRET_ENV = 'JWT_ACCESS_SECRET';

export interface StreamTicketClaims {
  sub: string;
  sessionId: string;
  roles: string[];
}

const consumed = new Map<string, number>(); // jti -> expiry epoch ms
let purgeAt = 0;

function secret(): string {
  const s = process.env[SECRET_ENV];
  if (!s || s.length < 16) throw new Error('stream tickets need a strong JWT_ACCESS_SECRET');
  return s;
}

function purge(now: number): void {
  if (now < purgeAt) return;
  purgeAt = now + 60_000;
  for (const [jti, exp] of consumed) if (exp <= now) consumed.delete(jti);
}

export function issueStreamTicket(claims: StreamTicketClaims): { ticket: string; expiresInSec: number } {
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ ...claims, jti: randomUUID(), exp, v: 1 }),
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', `${secret()}:stream-ticket-v1`).update(payload).digest('base64url');
  return { ticket: `${payload}.${sig}`, expiresInSec: Math.floor(TTL_MS / 1000) };
}

/** Returns claims if valid; REDEEMS (single-use) on success; null on any failure. */
export function redeemStreamTicket(ticket: string): (StreamTicketClaims & { exp: number }) | null {
  const dot = ticket.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  const expected = createHmac('sha256', `${secret()}:stream-ticket-v1`).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const now = Date.now();
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub: string; sessionId: string; roles: string[]; jti: string; exp: number; v: number;
    };
    if (data.v !== 1 || typeof data.jti !== 'string' || !data.sub || !data.sessionId) return null;
    purge(now);
    if (data.exp <= now) return null;
    if (consumed.has(data.jti)) return null; // replay ⇒ dead
    consumed.set(data.jti, data.exp);
    return { sub: data.sub, sessionId: data.sessionId, roles: data.roles ?? [], exp: data.exp };
  } catch {
    return null;
  }
}

/** test seam */
export function _resetConsumedTickets(): void {
  consumed.clear();
  purgeAt = 0;
}
