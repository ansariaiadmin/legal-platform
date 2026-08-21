import { SmsProvider, SendSmsResult } from './sms.provider';

export class MockSmsAdapter implements SmsProvider {
  async sendSms(input: { phone: string; message: string }): Promise<SendSmsResult> {
    // Only log OTP code in development, never in production
    if (process.env.NODE_ENV === 'development') {
      // Extract OTP code from message (assumes format contains the code)
      const otpMatch = input.message.match(/\b(\d{6})\b/);
      if (otpMatch) {
        console.log(`[MOCK SMS] OTP code for ${input.phone}: ${otpMatch[1]}`);
      } else {
        console.log(`[MOCK SMS] Message to ${input.phone}: ${input.message}`);
      }
    }
    
    return {
      success: true,
      messageId: `mock-${Date.now()}`,
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    // Mock provider is always valid in development
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        error: 'Mock SMS provider cannot be used in production',
      };
    }
    return { valid: true };
  }
}
