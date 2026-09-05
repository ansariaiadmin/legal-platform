import { createConnection } from 'node:net';

/**
 * Minimal RESP2 client (Node, raw sockets) — the TS twin of
 * apps/workers/py/pylegal/resp_client.py. The repo already does Redis liveness
 * by socket (modules/health/redis.ping.ts); this extends the same philosophy
 * to the few commands the python-worker bridge needs: LPUSH / GET / SET EX.
 *
 * Why not ioredis: zero dependency added, zero supply chain, and every byte
 * on the wire is reviewable here. Swap behind this class surface if the queue
 * ever grows pub/sub or blocking long-poll in Node.
 */

export class RespProtocolError extends Error {}

type RespValue = string | number | null | RespValue[];

function encode(args: string[]): Buffer {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) {
    const b = Buffer.byteLength(a, 'utf8');
    parts.push(`$${b}\r\n${a}\r\n`);
  }
  return Buffer.from(parts.join(''), 'utf8');
}

export class RedisRespClient {
  private readonly parsed: { host: string; port: number; password: string | null };

  constructor(
    url: string,
    private readonly timeoutMs = 3000,
  ) {
    // Fail-fast at construction: a malformed URL must break boot, not the
    // hundredth queue call deep in a request.
    const u = new URL(url);
    if (u.protocol !== 'redis:') throw new RespProtocolError(`unsupported scheme: ${u.protocol}`);
    this.parsed = {
      host: u.hostname || '127.0.0.1',
      port: Number(u.port) || 6379,
      password: u.password ? decodeURIComponent(u.password) : null,
    };
  }

  // @types/node ≥20.11 generics: Buffer<ArrayBufferLike> from socket reads is
  // structurally widen-than Buffer<ArrayBuffer> parameter positions expect.
  // `as Buffer` casts below are coercion-free at runtime (same object shape);
  // they exist purely so `strict` sees one consistent alias.
  private parseReply(buf: Buffer): { value: RespValue; rest: Buffer } {
    const type = String.fromCharCode(buf[0]);
    const end = buf.indexOf('\r\n', 1);
    if (end === -1) throw new RespProtocolError('incomplete reply');
    const head = buf.slice(1, end).toString('utf8');
    switch (type) {
      case '+':
        return { value: head, rest: buf.slice(end + 2) };
      case '-':
        throw new RespProtocolError(head);
      case ':':
        return { value: Number(head), rest: buf.slice(end + 2) };
      case '$': {
        const n = Number(head);
        if (n === -1) return { value: null, rest: buf.slice(end + 2) };
        const start = end + 2;
        return { value: buf.slice(start, start + n).toString('utf8'), rest: buf.slice(start + n + 2) };
      }
      case '*': {
        const n = Number(head);
        if (n === -1) return { value: null, rest: buf.slice(end + 2) };
        const arr: RespValue[] = [];
        let rest: Buffer = buf.slice(end + 2) as Buffer;
        for (let i = 0; i < n; i += 1) {
          const parsed = this.parseReply(rest);
          arr.push(parsed.value);
          rest = parsed.rest as Buffer;
        }
        return { value: arr, rest };
      }
      default:
        throw new RespProtocolError(`unknown type byte: ${type}`);
    }
  }

  /** Single-shot command over a fresh socket (simple, correct, boring). */
  async call(...args: string[]): Promise<RespValue> {
    const { host, port, password } = this.parsed;
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      const chunks: Buffer[] = [];
      const fail = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.setTimeout(this.timeoutMs);
      socket.once('error', fail);
      socket.once('timeout', () => fail(new RespProtocolError('timeout')));
      socket.once('connect', () => {
        socket.write(password ? encode(['AUTH', password]) : Buffer.alloc(0));
        socket.write(encode(args));
      });
      socket.on('data', (chunk) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        try {
          if (password && chunks.length < 2) return; // wait for AUTH +OK first
          const { value } = this.parseReply(password ? buf.slice(buf.indexOf('\r\n') + 2) : buf);
          socket.destroy();
          resolve(value);
        } catch (err) {
          if (err instanceof RespProtocolError && /incomplete/.test(err.message)) return; // wait for more
          fail(err as Error);
        }
      });
    });
  }

  async lpush(key: string, value: string): Promise<number> {
    return Number(await this.call('LPUSH', key, value));
  }

  async get(key: string): Promise<string | null> {
    const v = await this.call('GET', key);
    return typeof v === 'string' ? v : null;
  }
}
