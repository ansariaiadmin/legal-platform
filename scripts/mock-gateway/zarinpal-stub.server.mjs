/**
 * FIELD REVIEW 2026-09-05 #2b — a ZarinPal-shaped stub gateway for smoke and
 * CI. Speaks the SAME v4 JSON contract as the real thing:
 *
 *   POST /pg/v4/payment/request.json → { data: { code: 100, authority } }
 *   POST /pg/v4/payment/verify.json  → paid iff session was marked AND the
 *     amount matches what request.json recorded; code=100 first verify,
 *     code=101 on re-verify (ZarinPal's native idempotency), `-22` on amount
 *     mismatch, `-21` never paid, `-11` unknown authority.
 *
 * Dev-secret marking (sandbox parity): POST /__dev/mark-paid { authority }.
 * Without that POST, verify() says "not paid" — money cannot be minted by a
 * callback alone, same law as the real gateway.
 *
 * Run: `node scripts/mock-gateway/zarinpal-stub.server.mjs` (PORT=8085).
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8085);
const sessions = new Map(); // authority -> { amount, paid, verifies }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, code, json) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(json));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const body = req.method === 'POST' ? await readJson(req) : {};

    if (url.pathname === '/pg/v4/payment/request.json' && req.method === 'POST') {
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 1000) {
        return send(res, 200, { data: { code: -12, message: 'Amount below minimum' }, errors: [] });
      }
      const authority = `A${randomUUID().replace(/-/g, '').slice(0, 35).toUpperCase()}`;
      sessions.set(authority, { amount, paid: false, verifies: 0 });
      return send(res, 200, { data: { code: 100, authority, fee_type: 'Merchant', fee: 0 }, errors: [] });
    }

    if (url.pathname === '/pg/v4/payment/verify.json' && req.method === 'POST') {
      const { authority } = body;
      const amount = Number(body.amount);
      const s = sessions.get(authority);
      if (!s) return send(res, 200, { data: { code: -11, message: 'authority not found' }, errors: [] });
      if (amount !== s.amount) return send(res, 200, { data: { code: -22, message: 'amount mismatch' }, errors: [] });
      if (!s.paid) return send(res, 200, { data: { code: -21, message: 'no transaction paid' }, errors: [] });
      const code = s.verifies > 0 ? 101 : 100; // re-verify is an honest 101
      s.verifies += 1;
      return send(res, 200, { data: { code, ref_id: 100000 + s.verifies, amount: s.amount }, errors: [] });
    }

    // Sandbox-only control plane (never exists on the real gateway)
    if (url.pathname === '/__dev/mark-paid' && req.method === 'POST') {
      const s = sessions.get(String(body.authority ?? ''));
      if (!s) return send(res, 404, { error: 'unknown authority' });
      s.paid = true;
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/health') return send(res, 200, { ok: true, sessions: sessions.size });
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: (e && e.message) || 'bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`zarinpal-stub listening on :${PORT} (dev marking: POST /__dev/mark-paid)`);
});
