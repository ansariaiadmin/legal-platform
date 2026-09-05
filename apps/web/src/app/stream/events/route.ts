import { NextRequest } from 'next/server';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';

const API = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080';

/**
 * SSE tunnel (ADR-014): browsers cannot put Authorization on an EventSource,
 * so this same-origin route drains the API's guarded stream WITH the user's
 * token (same-origin ?token= only — dashboard tab injects it) and re-streams.
 *
 * WHY node:http and not fetch: Next.js patches global fetch inside route
 * handlers, and that patched fetch BUFFERS the response body — an event
 * stream would arrive only at close, which is exactly when the kitchen is
 * dead. Raw http.request keeps bytes flowing.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const target = new URL(`${API}/api/dashboard/orchestrator/events/stream`);

  const upstream = await new Promise<{ status: number; stream: IncomingMessage }>((resolve, reject) => {
    const r = httpRequest(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => resolve({ status: res.statusCode ?? 502, stream: res }),
    );
    r.on('error', reject);
    r.end();
  });

  if (upstream.status !== 200) {
    return new Response(`event: error\ndata: {"status":${upstream.status}}\n\n`, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`: connected\nretry: 4000\n\n`));
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        controller.enqueue(chunk);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };
      const heartbeat = setInterval(() => safeEnqueue(encoder.encode(`: hb\n\n`)), 15000);
      upstream.stream.on('data', (chunk: Buffer) => safeEnqueue(new Uint8Array(chunk)));
      upstream.stream.on('end', close);
      upstream.stream.on('error', close);
    },
    cancel() {
      upstream.stream.destroy();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const dynamic = 'force-dynamic';
