import { createConnection, type Socket } from 'node:net';

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

  /** P10 pub/sub: PUBLISH <channel> <message> → number of receivers. */
  async publish(channel: string, message: string): Promise<number> {
    return Number(await this.call('PUBLISH', channel, message));
  }

  /** Shared-rate-limit primitives (P9-T4): atomic INCR + PEXPIRE. */
  async incr(key: string): Promise<number> {
    return Number(await this.call('INCR', key));
  }

  async pexpire(key: string, ms: number): Promise<number> {
    return Number(await this.call('PEXPIRE', key, String(ms)));
  }
}

/**
 * P10 pub/sub: a DEDICATED long-lived socket in subscriber mode (RESP2).
 * After SUBSCRIBE is acked, Redis pushes `*3 $7 message $CH $PAYLOAD` frames
 * asynchronously; this class parses those pushes and invokes `onMessage`.
 *
 * Truth notes: one connection may ONLY subscribe once this mode starts (the
 * RFC forces it); reconnect is the owner's job (the bridge owns retries);
 * every parse error is surfaced via onError, never swallowed into silence.
 */
export class RespSubscriber {
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    url: string,
    private readonly onMessage: (channel: string, payload: string) => void,
    private readonly onError: (err: Error) => void,
    private readonly timeoutMs = 8000,
  ) {
    const u = new URL(url);
    if (u.protocol !== 'redis:') throw new RespProtocolError(`unsupported scheme: ${u.protocol}`);
    this.host = u.hostname || '127.0.0.1';
    this.port = Number(u.port) || 6379;
    this.password = u.password ? decodeURIComponent(u.password) : null;
  }

  private readonly host: string;
  private readonly port: number;
  private readonly password: string | null;

  subscribe(channel: string): void {
    const sock = createConnection(this.port, this.host);
    this.socket = sock;
    sock.setTimeout(this.timeoutMs * 12); // subscribe mode is quiet by nature
    sock.once('error', (e) => this.onError(e));
    sock.once('connect', () => {
      if (this.password) sock.write(encode(['AUTH', this.password]));
      sock.write(encode(['SUBSCRIBE', channel]));
    });
    sock.on('data', (chunk) => this.feed(chunk));
  }

  close(): void {
    try { this.socket?.destroy(); } catch { /* gone */ }
    this.socket = null;
  }

  private feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let frame: { value: RespValue; rest: Buffer };
      try {
        frame = this.parseReply(this.buffer);
      } catch (e) {
        if (e instanceof RespProtocolError && /incomplete/.test(e.message)) return; // wait for more bytes
        this.onError(e as Error);
        return;
      }
      this.buffer = frame.rest;
      const v = frame.value;
      if (Array.isArray(v) && v[0] === 'message' && typeof v[1] === 'string' && typeof v[2] === 'string') {
        this.onMessage(v[1], v[2]);
      }
      // subscribe/pong frames are acknowledgements — silently correct to skip
    }
  }

  /** Same RESP2 parser as RedisRespClient, shared shape (copied for framing
   * independence: a subscriber must survive partial frames). */
  private parseReply(buf: Buffer): { value: RespValue; rest: Buffer } {
    if (buf.length === 0) throw new RespProtocolError('incomplete reply');
    const type = String.fromCharCode(buf[0]);
    const end = buf.indexOf('\r\n', 1);
    if (end === -1) throw new RespProtocolError('incomplete reply');
    const head = buf.slice(1, end).toString('utf8');
    switch (type) {
      case '+': return { value: head, rest: buf.slice(end + 2) };
      case '-': return { value: null, rest: buf.slice(end + 2) };
      case ':': return { value: Number(head), rest: buf.slice(end + 2) };
      case '$': {
        const len = Number(head);
        if (len === -1) return { value: null, rest: buf.slice(end + 2) };
        if (buf.length < end + 2 + len + 2) throw new RespProtocolError('incomplete reply');
        // `as Buffer` — same @types/node ≥20.11 slice-generics note as the
        // client class above; coercion is free, this is for `strict` only.
        return { value: buf.slice(end + 2, end + 2 + len).toString('utf8'), rest: buf.slice(end + 2 + len + 2) as Buffer };
      }
      case '*': {
        const count = Number(head);
        if (count <= 0) return { value: [], rest: buf.slice(end + 2) as Buffer };
        const items: RespValue[] = [];
        let rest = buf.slice(end + 2) as Buffer;
        for (let i = 0; i < count; i++) {
          const r = this.parseReply(rest);
          items.push(r.value);
          rest = r.rest;
        }
        return { value: items, rest };
      }
      default:
        throw new RespProtocolError(`unknown type byte: ${type}`);
    }
  }
}
