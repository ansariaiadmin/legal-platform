import { ConfigService } from '@nestjs/config';
import { adapterKeyFromEnv, createAdapterFor } from '../../src/providers/provider.factory';
import { MockSmsAdapter } from '../../src/providers/sms/mock-sms.adapter';
import { MockPaymentAdapter } from '../../src/providers/payment/mock-payment.adapter';
import { GhasedakSmsAdapter } from '../../src/providers/sms/ghasedak.adapter';
import { KavenegarSmsAdapter } from '../../src/providers/sms/kavenegar.adapter';
import { PROVIDER_ERROR_CODES } from '../../src/providers/provider.error';
import { PROVIDER_CATEGORIES } from '../../src/providers/provider.tokens';
import { isHealthCheckable } from '../../src/providers/health-checkable';

describe('provider factory', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSms = process.env.SMS_PROVIDER;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalSms === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = originalSms;
  });

  it('builds the adapter selected for each category', () => {
    const config = new ConfigService();

    expect(createAdapterFor('sms', 'mock', config)).toBeInstanceOf(MockSmsAdapter);
    expect(createAdapterFor('payment', 'mock', config)).toBeInstanceOf(MockPaymentAdapter);
  });

  /**
   * SPEC section 12: no fake payment / sms / ai success in production.
   * The app must still boot, so a mock key yields an "unconfigured" adapter
   * that reports unhealthy and rejects every call (SPEC section 8).
   */
  it('never hands out a mock adapter in production', async () => {
    process.env.NODE_ENV = 'production';
    const config = new ConfigService();

    const payment = createAdapterFor('payment', 'mock', config) as {
      verifyConfig(): Promise<{ valid: boolean }>;
      createPaymentSession(input: unknown): Promise<unknown>;
    };
    expect(payment).not.toBeInstanceOf(MockPaymentAdapter);
    expect((await payment.verifyConfig()).valid).toBe(false);
    await expect(payment.createPaymentSession({ amount: 1000 })).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.CONFIG_INVALID,
    });

    const sms = createAdapterFor('sms', 'mock', config) as { sendSms(input: unknown): Promise<unknown> };
    expect(sms).not.toBeInstanceOf(MockSmsAdapter);
    await expect(sms.sendSms({ phone: '09120000000', message: 'x' })).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.CONFIG_INVALID,
    });
  });

  it('selects real SMS gateways from SMS_PROVIDER', () => {
    const config = new ConfigService({ GHASEDAK_API_KEY: 'k', KAVENEGAR_API_KEY: 'k' });
    expect(createAdapterFor('sms', 'ghasedak', config)).toBeInstanceOf(GhasedakSmsAdapter);
    expect(createAdapterFor('sms', 'kavenegar', config)).toBeInstanceOf(KavenegarSmsAdapter);
  });

  it('reads the adapter key from <CATEGORY>_PROVIDER and defaults to mock', () => {
    process.env.SMS_PROVIDER = 'kavenegar';
    expect(adapterKeyFromEnv('sms', new ConfigService())).toBe('kavenegar');

    delete process.env.SMS_PROVIDER;
    expect(adapterKeyFromEnv('sms', new ConfigService())).toBe('mock');
  });

  it('exposes a health check on every adapter it can build', () => {
    const config = new ConfigService();
    process.env.AI_EMBEDDING_DIMENSION = '1024';

    for (const category of PROVIDER_CATEGORIES) {
      const adapter = createAdapterFor(category, 'mock', config);
      expect(isHealthCheckable(adapter)).toBe(true);
    }
  });
});
