import {
  PushProvider,
  PushNotification,
  PushResult,
  PushProviderMetadata,
} from './push.provider';

export class MockPushAdapter implements PushProvider {
  constructor() {}

  async sendPush(input: {
    tokens: string[];
    notification: PushNotification;
    topic?: string;
  }): Promise<PushResult> {
    if (input.tokens.length === 0 && !input.topic) {
      return {
        success: false,
        error: 'Either tokens or topic must be provided',
      };
    }

    // Simulate successful push to all tokens
    const failedTokens: string[] = [];
    for (const token of input.tokens) {
      // Simulate occasional failure for invalid-looking tokens
      if (!token.startsWith('mock_token_')) {
        failedTokens.push(token);
      }
    }

    return {
      success: failedTokens.length < input.tokens.length,
      messageId: `mock_push_${Date.now()}`,
      failedTokens: failedTokens.length > 0 ? failedTokens : undefined,
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        error: 'Mock push provider cannot be used in production',
      };
    }
    return { valid: true };
  }

  getMetadata(): PushProviderMetadata {
    return {
      name: 'Mock Push Provider',
      supportsTopics: true,
      supportsDataPayload: true,
    };
  }
}
