import { ProviderError } from '../provider.error';

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** True when a mock adapter handled the message and nothing was delivered. */
  simulated?: boolean;
}

export interface SmsProvider {
  sendSms(input: { phone: string; message: string }): Promise<SendSmsResult>;
  verifyConfig(): Promise<{ valid: boolean; error?: string }>;
}

export { ProviderError };
