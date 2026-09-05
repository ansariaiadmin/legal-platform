import { spawn, type ChildProcess } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { ZarinpalAdapter } from '../../src/providers/payment/zarinpal.adapter';
import { resolve } from 'node:path';

/**
 * FIELD REVIEW 2026-09-05 #2b: the REAL ZarinPal adapter exercized against
 * the committed stub gateway (`scripts/mock-gateway/zarinpal-stub.server.mjs`)
 * — the same contract fuzz a real sandbox account would give, without a
 * merchant id. This test is the seam CI's docker profile reuses.
 */
describe('ZarinpalAdapter × committed stub gateway (real HTTP)', () => {
  let child: ChildProcess;
  let port: number;

  beforeAll(async () => {
    port = 18_085 + Math.floor(Math.random() * 500);
    child = spawn(process.execPath, [resolve(__dirname, '../../../../scripts/mock-gateway/zarinpal-stub.server.mjs')], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    });
    // wait for listen
    for (let i = 0; i < 40; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/health`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('stub gateway did not come up');
  });
  afterAll(() => { child.kill('SIGTERM'); });

  function adapter(): ZarinpalAdapter {
    return new ZarinpalAdapter(new ConfigService({
      ZARINPAL_MERCHANT_ID: 'stub-merchant-0000-0000-0000-000000000000',
      ZARINPAL_BASE_URL: `http://127.0.0.1:${port}/pg/v4/payment`,
      NODE_ENV: 'development',
    }));
  }

  it('happy path: request → pay at stub → verify(authority, amount) says paid', async () => {
    const z = adapter();
    const session = await z.createPaymentSession({
      amount: 200_000, currency: 'IRT',
      orderId: 'ci-smoke-1', callbackUrl: 'http://example/cb', metadata: {},
    });
    expect(session.sessionId).toMatch(/^A/);

    // user pays at the gateway (control plane, local stub only)
    await fetch(`http://127.0.0.1:${port}/__dev/mark-paid`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authority: session.sessionId }),
    });

    const v = await z.verifyCallback({
      paymentId: session.sessionId, status: 'paid',
      rawPayload: { amount: 200_000 },
    });
    expect(v.valid).toBe(true);
    expect(v.amount).toBe(200_000);

    // second verify is an honest 101 = still paid, still idempotent
    const v2 = await z.verifyCallback({
      paymentId: session.sessionId, status: 'paid',
      rawPayload: { amount: 200_000 },
    });
    expect(v2.valid).toBe(true);
  });

  it('refuses when the user never paid', async () => {
    const z = adapter();
    const session = await z.createPaymentSession({
      amount: 50_000, currency: 'IRT', orderId: 'ci-2', callbackUrl: 'http://example/cb',
    });
    const v = await z.verifyCallback({
      paymentId: session.sessionId, status: 'paid', rawPayload: { amount: 50_000 },
    });
    expect(v.valid).toBe(false);
  });

  it('amount mismatch is a structured failure, not a credit', async () => {
    const z = adapter();
    const session = await z.createPaymentSession({
      amount: 75_000, currency: 'IRT', orderId: 'ci-3', callbackUrl: 'http://example/cb',
    });
    await fetch(`http://127.0.0.1:${port}/__dev/mark-paid`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authority: session.sessionId }),
    });
    const v = await z.verifyCallback({
      paymentId: session.sessionId, status: 'paid',
      rawPayload: { amount: 999_999 }, // wire lies
    });
    expect(v.valid).toBe(false);
  });
});
