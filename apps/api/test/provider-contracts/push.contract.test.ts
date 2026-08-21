import { ConfigService } from '@nestjs/config';
import { MockPushAdapter } from '../../src/providers/push/mock-push.adapter';

interface PushContractTests {
  sendPush: () => Promise<boolean>;
  configHealthReporting: () => Promise<boolean>;
}

export function runPushContractTests(configService?: ConfigService): PushContractTests {
  const adapter = new MockPushAdapter(configService || new ConfigService());

  return {
    async sendPush(): Promise<boolean> {
      try {
        const result = await adapter.sendPush({
          tokens: ['mock_token_1', 'mock_token_2'],
          notification: {
            title: 'Test',
            body: 'Test body',
          },
        });
        return result.success === true;
      } catch {
        return false;
      }
    },

    async configHealthReporting(): Promise<boolean> {
      try {
        const health = await adapter.verifyConfig();
        return process.env.NODE_ENV !== 'production' ? health.valid === true : true;
      } catch {
        return false;
      }
    },
  };
}
