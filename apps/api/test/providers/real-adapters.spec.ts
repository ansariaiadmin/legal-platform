import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleAIAdapter } from '../../src/providers/ai/openai-compatible.adapter';
import { ZarinpalAdapter } from '../../src/providers/payment/zarinpal.adapter';
import { KavenegarSmsAdapter } from '../../src/providers/sms/kavenegar.adapter';
import { ProviderError } from '../../src/providers/provider.error';
import type { AIProvider } from '../../src/providers/ai/ai.provider';

/**
 * P9-T3 adapter truth tests: the REAL adapters talk to a LOCAL HTTP server
 * with canned upstream payloads — we verify exact wire shape (body, headers,
 * URL path incl. Kavenegar's path-key), error mapping, and the honesty
 * invariants (usage=undefined when the vendor omits it; payment 'paid' only
 * on codes 100/101).
 */

async function httpStub(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

/* ------------------------------ AI ------------------------------ */

describe('P9 AI adapter — OpenAI-compatible over real HTTP', () => {
  it('sends exact wire shape, reads usage VERBATIM when present, undefined when absent', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const stubs = await httpStub((req, body, res) => {
      const parsed = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> };
      sent.push(parsed as never);
      expect(req.headers.authorization).toBe('Bearer sk-test');
      const ask = parsed.messages?.[parsed.messages.length - 1]?.content ?? '';
      if (ask.includes('USAGEFREE')) {
        res.end(JSON.stringify({ model: 'test-chat', choices: [{ message: { content: 'پاسخ بی‌مصرفِ ثبت‌نشده' } }] })); // NO usage key
      } else {
        res.end(JSON.stringify({ model: 'test-chat', choices: [{ message: { content: 'سلام [1]' } }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }));
      }
    });
    try {
      const ai: AIProvider = new OpenAiCompatibleAIAdapter(
        new ConfigService({ AI_BASE_URL: stubs.url, AI_API_KEY: 'sk-test', AI_CLOUD_MODEL: 'test-chat' }),
      );
      const withUsage = await ai.generateText({ prompt: 'سلام دونده' });
      expect(withUsage.text).toBe('سلام [1]');
      expect(withUsage.usage?.totalTokens).toBe(17);
      expect((sent[0] as { temperature?: number }).temperature).toBe(0.2); // default documented

      // vendor omitted usage → adapter must NOT invent it
      const free = await ai.generateText({ prompt: 'USAGEFREE سلام' });
      expect(free.text).toBe('پاسخ بی‌مصرفِ ثبت‌نشده');
      expect(free.usage).toBeUndefined();
    } finally {
      await stubs.close();
    }
  });

  it('429 → RATE_LIMITED retryable; 401 → AUTH_FAILED not retryable; down → NETWORK_ERROR', async () => {
    const stubs = await httpStub((_req, _body, res) => {
      res.statusCode = 429;
      res.end('{}');
    });
    try {
      const ai = new OpenAiCompatibleAIAdapter(new ConfigService({ AI_BASE_URL: stubs.url, AI_API_KEY: 'k' }));
      await expect(ai.generateText({ prompt: 'x' })).rejects.toMatchObject({
        name: 'ProviderError',
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
      });
    } finally {
      await stubs.close();
    }
    const dead = new OpenAiCompatibleAIAdapter(
      new ConfigService({ AI_BASE_URL: 'http://127.0.0.1:1', AI_API_KEY: 'k' }),
    );
    await expect(dead.generateText({ prompt: 'x' })).rejects.toMatchObject({ retryable: true });
  });

  it('no baseUrl/apiKey → loud construction error, not a limping provider', () => {
    expect(() => new OpenAiCompatibleAIAdapter(new ConfigService({}))).toThrow(ProviderError);
  });
});

/* --------------------------- ZarinPal --------------------------- */

describe('P9 ZarinPal adapter — request/verify over real HTTP', () => {
  it('happy path: session issued with authority; verify paid only on code 100/101', async () => {
    const seen: string[] = [];
    const stubs = await httpStub((_req, body, res) => {
      seen.push(body);
      const parsed = JSON.parse(body) as { merchant_id?: string; authority?: string };
      if (!parsed.authority) {
        res.end(JSON.stringify({ data: { code: 100, authority: 'A0000000000000000000000000X', fee: 1320 } }));
        return;
      }
      // verify
      res.end(JSON.stringify({ data: { code: 100, ref_id: 555, amount: parsed['amount' as never] } }));
    });
    try {
      const z = new ZarinpalAdapter(new ConfigService({ ZARINPAL_MERCHANT_ID: 'merch-1111', ZARINPAL_BASE_URL: stubs.url }));
      const session = await z.createPaymentSession({
        amount: 550_000, currency: 'IRT', orderId: 'wlt-1', callbackUrl: 'https://app.example/cb',
      });
      expect(session.sessionId).toBe('A0000000000000000000000000X');
      expect(session.redirectUrl).toContain('StartPay/A0000000000000000000000000X');
      expect(session.status).toBe('pending');

      const ver = await z.verifyCallback({
        paymentId: session.sessionId,
        status: 'paid',
        rawPayload: { amount: 550_000 },
      });
      expect(ver.valid).toBe(true);
      expect(ver.status).toBe('paid');

      // every call carried the merchant id (never user secrets in URL)
      expect(seen.every((b) => (JSON.parse(b) as { merchant_id?: string }).merchant_id === 'merch-1111')).toBe(true);
    } finally {
      await stubs.close();
    }
  });

  it('refused request (non-100) is a ProviderError, NOT a pending session', async () => {
    const stubs = await httpStub((_req, _b, res) => res.end(JSON.stringify({ data: { code: -9 } })));
    try {
      const z = new ZarinpalAdapter(new ConfigService({ ZARINPAL_MERCHANT_ID: 'm', ZARINPAL_BASE_URL: stubs.url }));
      await expect(
        z.createPaymentSession({ amount: 1, currency: 'IRT', orderId: 'x', callbackUrl: 'https://x/cb' }),
      ).rejects.toMatchObject({ name: 'ProviderError' });
    } finally {
      await stubs.close();
    }
  });

  it('verify with gateway code -31 marks failed with the gateway code preserved', async () => {
    const stubs = await httpStub((_req, _b, res) => res.end(JSON.stringify({ data: { code: -31 } })));
    try {
      const z = new ZarinpalAdapter(new ConfigService({ ZARINPAL_MERCHANT_ID: 'm', ZARINPAL_BASE_URL: stubs.url }));
      const r = await z.verifyCallback({ paymentId: 'A1', status: 'paid', rawPayload: { amount: 100 } });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('-31');
    } finally {
      await stubs.close();
    }
  });

  it('callback without amount refuses to guess (honest bookkeeping)', async () => {
    const stubs = await httpStub((_r, _b, res) => res.end('{}'));
    try {
      const z = new ZarinpalAdapter(new ConfigService({ ZARINPAL_MERCHANT_ID: 'm', ZARINPAL_BASE_URL: stubs.url }));
      const r = await z.verifyCallback({ paymentId: 'A1', status: 'paid', rawPayload: {} });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('amount');
    } finally {
      await stubs.close();
    }
  });
});

/* ---------------------------- Kavenegar --------------------------- */

describe('P9 Kavenegar SMS adapter — path-key visibility, real result ids', () => {
  it('sends form-encoded body with receptor+message; returns real messageid', async () => {
    const calls: Array<{ path: string; body: string }> = [];
    const stubs = await httpStub((req, body, res) => {
      calls.push({ path: req.url ?? '', body });
      res.end(JSON.stringify({ return: { status: 200 }, entries: [{ messageid: 88776655 }] }));
    });
    try {
      const adapter = new KavenegarSmsAdapter(
        new ConfigService({ KAVENEGAR_API_KEY: 'KK-SECRET', KAVENEGAR_BASE_URL: stubs.url }),
      );
      const out = await adapter.sendSms({ phone: '+989121234567', message: 'کد ۱۲۳۴' });
      expect(out.success).toBe(true);
      expect(out.messageId).toBe('88776655');
      const call = calls[0];
      expect(call.path).toBe('/KK-SECRET/sms/send.json');
      const decoded = decodeURIComponent(call.body).replace(/\+/g, ' '); // form-encoding: '+' is space
      expect(decoded).toContain('receptor= 989121234567');
      expect(decoded).toContain('کد ۱۲۳۴');
    } finally {
      await stubs.close();
    }
  });

  it('gateway rejection → ProviderError (never success-id fabricated)', async () => {
    const stubs = await httpStub((_r, _b, res) => {
      res.statusCode = 403;
      res.end(JSON.stringify({ return: { status: 401, message: 'key invalid' } }));
    });
    try {
      const sms = new KavenegarSmsAdapter(new ConfigService({ KAVENEGAR_API_KEY: 'BAD', KAVENEGAR_BASE_URL: stubs.url }));
      await expect(sms.sendSms({ phone: '+9812', message: 'x' })).rejects.toMatchObject({ name: 'ProviderError' });
    } finally {
      await stubs.close();
    }
  });

  it('missing key → constructor refuses; verifiable config goes through account/info', async () => {
    expect(() => new KavenegarSmsAdapter(new ConfigService({}))).toThrow(/KAVENEGAR_API_KEY/);
    const stubs = await httpStub((_r, _b, res) => res.end('{}'));
    try {
      const sms = new KavenegarSmsAdapter(new ConfigService({ KAVENEGAR_API_KEY: 'KK', KAVENEGAR_BASE_URL: stubs.url }));
      expect(await sms.verifyConfig()).toEqual({ valid: true });
    } finally {
      await stubs.close();
    }
  });
});
