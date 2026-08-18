export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SmsProvider {
  sendSms(input: { phone: string; message: string }): Promise<SendSmsResult>;
  verifyConfig(): Promise<{ valid: boolean; error?: string }>;
}
