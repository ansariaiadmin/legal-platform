import { MockSmsAdapter } from '../../src/providers/sms/mock-sms.adapter';

/**
 * Contract every SmsProvider adapter must satisfy (SPEC section 8).
 * These assertions run against the mock; a real gateway adapter gets the same
 * suite pointed at it.
 */
describe('SmsProvider contract', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('delivers a message and returns a provider message id', async () => {
    const adapter = new MockSmsAdapter();
    const result = await adapter.sendSms({
      phone: '+989123456789',
      message: 'کد تأیید شما: 123456',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toEqual(expect.any(String));
  });

  it('captures what it sent so the OTP can be read back in development', async () => {
    const adapter = new MockSmsAdapter();
    await adapter.sendSms({ phone: '+989120000001', message: 'کد تأیید شما: 654321' });

    const messages = adapter.messagesFor('+989120000001');
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('654321');
  });

  it('reports healthy in development and refuses to be healthy in production', async () => {
    const adapter = new MockSmsAdapter();

    expect((await adapter.verifyConfig()).valid).toBe(true);

    process.env.NODE_ENV = 'production';
    const production = await adapter.verifyConfig();
    expect(production.valid).toBe(false);
    expect(production.error).toBeDefined();
  });
});
