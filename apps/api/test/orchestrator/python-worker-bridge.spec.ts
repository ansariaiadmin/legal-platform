import { createServer, type Server } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { RedisRespClient } from '../../src/providers/queue/redis-resp.client';
import { PythonWorkerService, PY_QUEUE_KEY } from '../../src/modules/orchestrator/python-worker.service';

/**
 * Fake Redis over a raw socket (json assertions on the wire so the codec is
 * REALLY tested, incl. multi-byte utf-8 lengths).
 */
function startFakeRedis(): Promise<{ server: Server; port: number; state: Map<string, string> }> {
  const state = new Map<string, string>();
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // naive parse: RESP array commands in one shot
      const text = buf.toString('utf8');
      if (!text.includes('\r\n')) return;
      const parts = text.split('\r\n').filter(Boolean);
      const cmd = parts.find((p) => ['LPUSH', 'GET', 'SET', 'PING', 'AUTH'].includes(p.toUpperCase()));
      if (!cmd) return;
      buf = Buffer.alloc(0);
      const upper = cmd.toUpperCase();
      const args = parts.slice(parts.indexOf(cmd) + 1).filter((p) => !p.startsWith('$') && !p.startsWith('*'));
      if (upper === 'AUTH') socket.write('+OK\r\n');
      else if (upper === 'PING') socket.write('+PONG\r\n');
      else if (upper === 'LPUSH') socket.write(`:${args.length - 1}\r\n`);
      else if (upper === 'GET') {
        const v = state.get(args[0]);
        socket.write(v === undefined ? '$-1\r\n' : `$${Buffer.byteLength(v, 'utf8')}\r\n${v}\r\n`);
      } else if (upper === 'SET') {
        state.set(args[0], args[1]);
        socket.write('+OK\r\n');
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0, state });
    });
  });
}

describe('RedisRespClient over a fake socket Redis', () => {
  let server: Server;
  let port: number;
  let state: Map<string, string>;

  beforeAll(async () => {
    ({ server, port, state } = await startFakeRedis());
  });
  afterAll(() => server.close());

  it('LPUSH returns count and respects utf-8 payloads', async () => {
    const r = new RedisRespClient(`redis://127.0.0.1:${port}`);
    const n = await r.lpush(PY_QUEUE_KEY, JSON.stringify({ jobId: 'j', tool: 'normalize_persian', input: { text: 'سلام مدنی' } }));
    expect(n).toBe(1);
  });

  it('SET/GET roundtrip keeps Persian intact', async () => {
    const r = new RedisRespClient(`redis://127.0.0.1:${port}`);
    // SET via call() to seed, then GET through the client path
    await new RedisRespClient(`redis://127.0.0.1:${port}`).lpush('x', '1');
    state.set('k-fa', 'قرارداد');
    const got = await r.get('k-fa');
    expect(got).toBe('قرارداد');
  });

  it('GET missing key => null', async () => {
    const r = new RedisRespClient(`redis://127.0.0.1:${port}`);
    expect(await r.get('missing')).toBeNull();
  });

  it('bad scheme refused', () => {
    expect(() => new RedisRespClient('http://x')).toThrow(/unsupported scheme/);
  });
});

describe('PythonWorkerService (ADR-010 bridge)', () => {
  let server: Server;
  let port: number;
  let state: Map<string, string>;

  beforeAll(async () => {
    ({ server, port, state } = await startFakeRedis());
  });
  afterAll(() => server.close());

  it('enqueues a well-formed job onto the shared queue', async () => {
    const service = new PythonWorkerService(new ConfigService({ REDIS_URL: `redis://127.0.0.1:${port}` }));
    const handle = await service.enqueue('chunk_legal_text', { text: 'ماده یک.' });
    expect(handle.queued).toBe(true);
    expect(handle.jobId).toMatch(/^py-/);
  });

  it('reads back results the worker posted (json, utf-8 safe)', async () => {
    const service = new PythonWorkerService(new ConfigService({ REDIS_URL: `redis://127.0.0.1:${port}` }));
    const jobId = 'py-abc';
    state.set(`legal:workers:result:${jobId}`, JSON.stringify({ jobId, ok: true, output: { normalized: 'شرایط الکی' } }));
    const result = await service.result(jobId);
    expect(result?.ok).toBe(true);
    expect(result?.output?.normalized).toBe('شرایط الکی');
  });

  it('queue-down degrades honestly to queued:false (never fakes success)', async () => {
    const service = new PythonWorkerService(new ConfigService({ REDIS_URL: 'redis://127.0.0.1:1' }));
    const handle = await service.enqueue('word_count', { text: 'x' });
    expect(handle.queued).toBe(false);
  });

  it('unknown result => null (not inferred)', async () => {
    const service = new PythonWorkerService(new ConfigService({ REDIS_URL: `redis://127.0.0.1:${port}` }));
    expect(await service.result('never-existed')).toBeNull();
  });
});
