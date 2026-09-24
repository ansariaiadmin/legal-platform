import { MockPushAdapter } from '../../src/providers/push/mock-push.adapter';

/** PushProvider contract (SPEC section 8). */
describe('PushProvider contract', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('sends to valid tokens and reports which ones failed', async () => {
    const adapter = new MockPushAdapter();

    const result = await adapter.sendPush({
      tokens: ['mock_token_1', 'not_a_mock_token'],
      notification: { title: 'یادآوری', body: 'جلسهٔ مشاورهٔ شما فرداست' },
    });

    expect(result.success).toBe(true);
    expect(result.failedTokens).toEqual(['not_a_mock_token']);
  });

  it('fails when neither tokens nor a topic are supplied', async () => {
    const adapter = new MockPushAdapter();

    const result = await adapter.sendPush({
      tokens: [],
      notification: { title: 'x', body: 'y' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('reports healthy outside production only', async () => {
    const adapter = new MockPushAdapter();
    expect((await adapter.verifyConfig()).valid).toBe(true);

    process.env.NODE_ENV = 'production';
    expect((await adapter.verifyConfig()).valid).toBe(false);
  });
});
