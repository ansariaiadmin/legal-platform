import { ConfigService } from '@nestjs/config';
import { adapterKeyFromEnv, createAdapterFor } from '../../src/providers/provider.factory';
import { MockSmsAdapter } from '../../src/providers/sms/mock-sms.adapter';
import { MockPaymentAdapter } from '../../src/providers/payment/mock-payment.adapter';
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

  /** SPEC section 12: no fake payment / sms / ai success in production. */
  it('refuses to build a mock adapter in production', () => {
    process.env.NODE_ENV = 'production';

    expect(() => createAdapterFor('payment', 'mock', new ConfigService())).toThrow(
      expect.objectContaining({ code: PROVIDER_ERROR_CODES.CONFIG_INVALID }),
    );
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
