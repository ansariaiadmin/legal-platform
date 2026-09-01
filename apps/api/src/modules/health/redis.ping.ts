import { createConnection, type Socket } from 'net';

export interface RedisPingResult {
  reachable: boolean;
  error?: string;
  latencyMs?: number;
}

/**
 * Minimal Redis liveness probe.
 *
 * The platform does not use Redis yet (no queue has been implemented), so
 * pulling in a full client just to send `PING` is not justified. This opens a
 * socket, sends an inline `PING` and expects `+PONG`.
 */
export function pingRedis(redisUrl: string, timeoutMs = 2000): Promise<RedisPingResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(redisUrl);
    } catch {
      resolve({ reachable: false, error: 'REDIS_URL is not a valid URL' });
      return;
    }

    const host = parsed.hostname || '127.0.0.1';
    const port = Number(parsed.port) || 6379;
    const startedAt = Date.now();

    let socket: Socket;
    try {
      socket = createConnection({ host, port });
    } catch (error) {
      resolve({ reachable: false, error: error instanceof Error ? error.message : 'connect failed' });
      return;
    }

    let settled = false;
    const finish = (result: RedisPingResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('error', (error: Error) => finish({ reachable: false, error: error.message }));
    socket.once('timeout', () => finish({ reachable: false, error: `timeout after ${timeoutMs}ms` }));

    socket.once('connect', () => {
      const password = parsed.password ? decodeURIComponent(parsed.password) : null;
      socket.write(password ? `AUTH ${password}\r\nPING\r\n` : 'PING\r\n');
    });

    socket.on('data', (chunk: Buffer) => {
      const reply = chunk.toString('utf8');
      if (reply.includes('+PONG')) {
        finish({ reachable: true, latencyMs: Date.now() - startedAt });
      } else if (reply.startsWith('-')) {
        finish({ reachable: false, error: reply.trim().slice(1) });
      }
    });
  });
}
