/**
 * P9-T4 contract test: shared Redis rate limiter against a REAL in-test RESP
 * server (node socket) — same seam pattern as the HTTP-adapter tests: the
 * client does real I/O, the vendor is an honest stub we fully control.
 */
import * as net from 'net';
import { RedisRateLimitService } from '../../src/common/redis-rate-limit.service';

function fakeRedis() {
  const kv = new Map<string, { v: number; exp?: number }>();
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      // naive RESP parse: complete command = *N followed by N $-blocks
      const lines = buf.split('\r\n');
      if (lines.length < 2 || !lines[0].startsWith('*')) return;
      const n = Number(lines[0].slice(1));
      if (lines.length < 1 + n * 2) return; // partial frame
      const args: string[] = [];
      for (let i = 0; i < n; i++) args.push(lines[2 + i * 2]);
      buf = lines.slice(1 + n * 2).join('\r\n');
      const c = (args[0] ?? '').toUpperCase();
      if (!c) { sock.write('-ERR empty\r\n'); return; }
      if (c === 'INCR') {
        const rec = kv.get(args[1]) ?? { v: 0 };
        rec.v += 1;
        kv.set(args[1], rec);
        sock.write(`:${rec.v}\r\n`);
      } else if (c === 'PEXPIRE') {
        const rec = kv.get(args[1]);
        if (rec) rec.exp = Number(args[2]);
        sock.write(`:1\r\n`);
      } else {
        sock.write(`+OK\r\n`);
      }
    });
  });
  return { server, kv };
}

describe('P9-T4 RedisRateLimitService (real RESP wire)', () => {
  let server: net.Server;
  let port: number;
  let svc: RedisRateLimitService;

  beforeAll(async () => {
    ({ server } = fakeRedis());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as any).port;
    const cfg = { get: (k: string) => (k === 'REDIS_URL' ? `redis://127.0.0.1:${port}` : undefined) } as any;
    svc = new RedisRateLimitService(cfg);
  });

  afterAll(() => server.close());

  it('counts a shared bucket and denies past the limit', async () => {
    const rule = { limit: 3, windowMs: 60_000, cooldownMs: 0, lockMs: 0 };
    const d1 = await svc.consume('floor:ip:1', rule);
    expect(d1).toMatchObject({ allowed: true, remaining: 2 });
    await svc.consume('floor:ip:1', rule);
    await svc.consume('floor:ip:1', rule);
    const d4 = await svc.consume('floor:ip:1', rule);
    expect(d4.allowed).toBe(false);
    expect(d4.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('different keys get independent shared buckets', async () => {
    const rule = { limit: 1, windowMs: 60_000, cooldownMs: 0, lockMs: 0 };
    expect((await svc.consume('floor:ip:A', rule)).allowed).toBe(true);
    expect((await svc.consume('floor:ip:A', rule)).allowed).toBe(false);
    expect((await svc.consume('floor:ip:B', rule)).allowed).toBe(true);
  });

  it('fails CLOSED (deny, loud, short retry) when Redis is unreachable', async () => {
    const deadSvc = new RedisRateLimitService({ get: () => 'redis://127.0.0.1:1' } as any);
    const d = await deadSvc.consume('x', { limit: 100, windowMs: 1000, cooldownMs: 0, lockMs: 0 });
    expect(d.allowed).toBe(false); // floodgate stays shut
    expect(d.rejection).toBe('locked');
    expect(d.retryAfterSeconds).toBeLessThanOrEqual(5);
  });
});
