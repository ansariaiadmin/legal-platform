export interface EmailSendInput {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailProviderMetadata {
  name: string;
  driverType: 'smtp' | 'mock';
}

/**
 * P10 — email as a first-class provider. The auth factor (email OTP) and any
 * future magic-links talk ONLY to this port; the adapter decides mock vs real
 * SMTP. Same SPEC §8 discipline as sms/payment.
 */
export interface EmailProvider {
  sendMail(input: EmailSendInput): Promise<EmailSendResult>;
  verifyConfig(): Promise<{ valid: boolean; error?: string }>;
  getMetadata(): EmailProviderMetadata;
}
