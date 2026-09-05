/**
 * P10-T-bus contract: two event bridges → one fake Redis (real socket pubsub,
 * stub we control). Proves: local emit on A crosses to B, loop is blocked by
 * origin id, ring continuity holds for SSE consumers.
 */
import * as net from 'node:net';
import { ConfigService } from '@nestjs/config';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import { RedisEventBridge } from '../../src/modules/orchestrator/redis-event-bridge.service';

const CHANNEL = 'legal:events:bus';

function encResp(...args: string[]): Buffer {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) { parts.push(`$${Buffer.byteLength(a, 'utf8')}\r\n${a}\r\n`); }
  return Buffer.from(parts.join(''), 'utf8');
}

function fakePubSubRedis() {
  const subscribers: net.Socket[] = [];
  const published: Array<{ channel: string; payload: string }> = [];
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      // naive RESP parse: complete "*N" frames
      for (;;) {
        const lines = buf.split('\r\n');
        if (lines.length < 2 || !lines[0].startsWith('*')) return;
        const n = Number(lines[0].slice(1));
        if (lines.length < 1 + n * 2) return;
        const args: string[] = [];
        for (let i = 0; i < n; i++) args.push(lines[2 + i * 2]);
        buf = lines.slice(1 + n * 2).join('\r\n');
        const cmd = (args[0] ?? '').toUpperCase();
        if (cmd === 'SUBSCRIBE') {
          subscribers.push(sock);
          sock.write(encResp('subscribe', args[1], '1'));
        } else if (cmd === 'PUBLISH') {
          published.push({ channel: args[1], payload: args[2] });
          for (const sub of subscribers) {
            sub.write(encResp('message', args[1], args[2]));
          }
          sock.write(`:${subscribers.length}\r\n`);
        } else {
          sock.write('+OK\r\n');
        }
      }
    });
    sock.on('close', () => {
      const i = subscribers.indexOf(sock);
      if (i >= 0) subscribers.splice(i, 1);
    });
  });
  return { server, published, subscribers };
}

const fakeEvent = (kind: string) => ({ type: kind, at: new Date().toISOString(), payloadGap: true } as never);

describe('P10-T-bus RedisEventBridge (real pubsub wire)', () => {
  let server: net.Server;
  let port: number;
  let published: Array<{ channel: string; payload: string }>;

  beforeAll(async () => {
    ({ server, published } = fakePubSubRedis());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as net.AddressInfo).port;
  });
  afterAll(() => server.close());

  function makeBridge(): { bus: InProcessAgentEventBus; bridge: RedisEventBridge } {
    const bus = new InProcessAgentEventBus();
    const cfg = new ConfigService({ REDIS_URL: `redis://127.0.0.1:${port}`, DEPLOYMENT_MODE: 'multi' });
    const bridge = new RedisEventBridge(cfg, bus);
    bridge.onModuleInit();
    return { bus, bridge };
  }

  async function tick(ms = 150) { await new Promise((r) => setTimeout(r, ms)); }

  it('bridging is OFF in single mode — honest, not silently half-on', () => {
    const bus = new InProcessAgentEventBus();
    const cfg = new ConfigService({ REDIS_URL: `redis://127.0.0.1:${port}`, DEPLOYMENT_MODE: 'single' });
    const bridge = new RedisEventBridge(cfg, bus);
    bridge.onModuleInit();
    expect(bridge.isLive()).toBe(false);
  });

  it('an event emitted on replica A reaches replica B’s ring (SSE needs no code change)', async () => {
    const { bus: busA } = makeBridge();
    const { bus: busB } = makeBridge();
    await tick(); // let both SUBSCRIBE handshakes land
    busA.emit(fakeEvent('task.accepted'));
    await tick();
    expect(published.some((p) => p.channel === CHANNEL && p.payload.includes('task.accepted'))).toBe(true);
    expect(busB.recent(10).some((e) => (e as never as { type: string }).type === 'task.accepted')).toBe(true);
  });

  it('loop guard: a replica NEVER receives its own event back', async () => {
    const { bus } = makeBridge();
    await tick();
    const before = bus.recent(10).length;
    bus.emit(fakeEvent('inference.decided'));
    await tick();
    // the emit lands exactly once in the ring — emitRemote must not double it
    const mine = bus.recent(10).filter((e) => (e as never as { type: string }).type === 'inference.decided');
    expect(mine.length).toBe(1);
    expect(bus.recent(10).length).toBe(before + 1);
  });
});
