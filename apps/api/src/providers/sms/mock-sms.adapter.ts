import { SmsProvider, SendSmsResult } from './sms.provider';

const MAX_CAPTURED = 100;

export interface CapturedSms {
  phone: string;
  message: string;
  sentAt: string;
}

/**
 * Development-only SMS adapter.
 *
 * It captures what it "sent" so the dashboard and the integration tests can
 * read back an OTP without a real gateway. The capture buffer is bounded and
 * the code is only logged outside production. `verifyConfig()` refuses to
 * report healthy in production, so a mock can never masquerade as a working
 * provider on a real deployment (SPEC section 12).
 */
export class MockSmsAdapter implements SmsProvider {
  private readonly captured: CapturedSms[] = [];

  async sendSms(input: { phone: string; message: string }): Promise<SendSmsResult> {
    this.captured.push({ phone: input.phone, message: input.message, sentAt: new Date().toISOString() });
    if (this.captured.length > MAX_CAPTURED) {
      this.captured.shift();
    }

    if (process.env.NODE_ENV !== 'production') {
      const otpMatch = input.message.match(/\b(\d{6})\b/);
      if (otpMatch) {
        // eslint-disable-next-line no-console
        console.log(`[MOCK SMS] OTP code for ${input.phone}: ${otpMatch[1]}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[MOCK SMS] Message to ${input.phone}: ${input.message}`);
      }
    }

    return {
      success: true,
      messageId: `mock-${Date.now()}`,
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        error: 'Mock SMS provider cannot be used in production',
      };
    }
    return { valid: true };
  }

  /** Most recent message for a destination, newest first. */
  messagesFor(phone: string): CapturedSms[] {
    return this.captured.filter((entry) => entry.phone === phone).reverse();
  }

  clearCaptured(): void {
    this.captured.length = 0;
  }
}
