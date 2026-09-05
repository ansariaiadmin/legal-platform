import { ConfigService } from '@nestjs/config';
import { AlertRelayService } from '../../src/common/alert-relay.service';

/**
 * FIELD REVIEW #13: an alert nobody receives is the same as no alert.
 * This spec proves the webhook relay path — and its honest refusal when
 * unconfigured or the webhook is down.
 */
describe('alert relay — critical events leave the box', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  function relayWith(env: Record<string, string>, fetchImpl?: typeof fetch) {
    if (fetchImpl) global.fetch = fetchImpl;
    return new AlertRelayService(new ConfigService(env));
  }

  it('posts a Persian text payload for critical kinds', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fake = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;

    const relay = relayWith({ ALERT_WEBHOOK_URL: 'https://hooks.example/tok' }, fake);
    const out = await relay.relay({
      kind: 'usage.alerted', at: '2026-09-05T00:00:00.000Z',
      taskId: 'usage-2026-09', agentId: 'legal-leader',
      detail: 'harm 55 USD crosses 50 USD, month 2026-09',
    } as never);

    expect(out).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hooks.example/tok');
    expect(String(calls[0].body.text)).toContain('usage.alerted');
  });

  it('ignores non-critical kinds — the channel stays a fire channel, not noise', async () => {
    let hits = 0;
    const fake = (async () => { hits += 1; return { ok: true } as Response; }) as unknown as typeof fetch;
    const relay = relayWith({ ALERT_WEBHOOK_URL: 'https://hooks.example/tok' }, fake);
    expect(await relay.relay({ kind: 'skill.started', at: 'x', taskId: 't', agentId: null } as never)).toBe('ignored');
    expect(hits).toBe(0);
  });

  it('unconfigured ⇒ admits it (no silent drop)', async () => {
    const relay = relayWith({});
    expect(await relay.relay({ kind: 'usage.alerted', at: 'x', taskId: 't', agentId: null } as never)).toBe('unconfigured');
  });

  it('webhook 5xx ⇒ logged and swallowed, the guarded thing keeps working', async () => {
    const fake = (async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    const relay = relayWith({ ALERT_WEBHOOK_URL: 'https://hooks.example/tok' }, fake);
    await expect(relay.relay({ kind: 'usage.alerted', at: 'x', taskId: 't', agentId: null } as never)).resolves.toBe('ignored');
  });
});
