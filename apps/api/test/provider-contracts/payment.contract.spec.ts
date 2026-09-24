import { MockPaymentAdapter } from '../../src/providers/payment/mock-payment.adapter';
import { PROVIDER_ERROR_CODES } from '../../src/providers/provider.error';

/**
 * PaymentProvider contract (SPEC section 6 and 8): a session is created, the
 * callback signature is verified, and duplicate callbacks are idempotent.
 */
describe('PaymentProvider contract', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('creates a pending session with an expiry and a redirect url', async () => {
    const adapter = new MockPaymentAdapter();
    const session = await adapter.createPaymentSession({
      amount: 1000,
      currency: 'IRR',
      orderId: 'order-1',
      callbackUrl: 'https://example.com/callback',
    });

    expect(session.status).toBe('pending');
    expect(session.amount).toBe(1000);
    expect(session.redirectUrl).toEqual(expect.any(String));
    expect(session.expiresAt.getTime()).toBeGreaterThan(session.createdAt.getTime());
  });

  it('rejects a callback whose signature does not match', async () => {
    const adapter = new MockPaymentAdapter();

    const result = await adapter.verifyCallback({
      paymentId: 'pay-1',
      status: 'paid',
      signature: 'deadbeef',
      rawPayload: { amount: 1000 },
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('accepts an unsigned callback and de-duplicates a replay', async () => {
    const adapter = new MockPaymentAdapter();
    const payload = {
      paymentId: 'pay-2',
      status: 'paid' as const,
      rawPayload: { amount: 1000 },
    };

    const first = await adapter.verifyCallback(payload);
    const replay = await adapter.verifyCallback(payload);

    expect(first.valid).toBe(true);
    expect(replay.valid).toBe(true);
    // The adapter advertises adapter-level de-duplication, not native idempotency.
    expect(adapter.getMetadata().idempotencyCapability.type).toBe('adapter-dedup');
  });

  it('throws a normalised PROVIDER_NOT_FOUND for an unknown payment', async () => {
    const adapter = new MockPaymentAdapter();

    await expect(adapter.queryPaymentStatus('does-not-exist')).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.NOT_FOUND,
    });
  });

  it('refuses to report healthy in production', async () => {
    const adapter = new MockPaymentAdapter();
    process.env.NODE_ENV = 'production';

    const health = await adapter.verifyConfig();
    expect(health.valid).toBe(false);
  });
});
