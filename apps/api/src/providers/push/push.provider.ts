import { ProviderError } from '../provider.error';

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  success: boolean;
  messageId?: string;
  failedTokens?: string[];
  error?: string;
}

export interface PushProviderConfig {
  apiKey?: string;
  projectId?: string;
  serviceAccountKey?: string;
}

export interface PushProviderMetadata {
  name: string;
  supportsTopics: boolean;
  supportsDataPayload: boolean;
}

export interface PushProvider {
  sendPush(input: {
    tokens: string[];
    notification: PushNotification;
    topic?: string;
  }): Promise<PushResult>;

  verifyConfig(): Promise<{ valid: boolean; error?: string }>;

  getMetadata(): PushProviderMetadata;
}

export { ProviderError };
