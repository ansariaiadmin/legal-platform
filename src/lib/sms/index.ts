export * from './ghasedak.adapter';
export * from './kavenegar.adapter';
import { GhasedakAdapter } from './ghasedak.adapter';
import { KavenegarAdapter } from './kavenegar.adapter';
import { logger } from '@/lib/logger';

export type SmsProviderId = 'ghasedak' | 'kavenegar' | 'melipayamak' | 'mock';

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  cost?: number;
  provider: SmsProviderId;
}

export class SmsService {
  private provider: SmsProviderId;
  private apiKey: string;
  private sender: string;

  constructor() {
    this.provider = (process.env.SMS_PROVIDER as SmsProviderId) || 'mock';
    this.apiKey = process.env.SMS_API_KEY || process.env.GHASEDAK_API_KEY || process.env.KAVENEGAR_API_KEY || '';
    this.sender = process.env.SMS_SENDER || '';
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    if (this.provider === 'mock' || !this.apiKey) {
      logger.info({ to, message: message.slice(0, 50) }, 'Mock SMS — logged only — تاریکی روشن شد: پیامک واقعی نمی‌ره — پنل وصل کن');
      return { success: true, messageId: `mock-${Date.now()}`, provider: 'mock', cost: 0 };
    }

    try {
      if (this.provider === 'ghasedak') {
        const adapter = new GhasedakAdapter({ apiKey: this.apiKey, sender: this.sender });
        const res = await adapter.send(to, message);
        return { ...res, provider: 'ghasedak' };
      } else if (this.provider === 'kavenegar') {
        const adapter = new KavenegarAdapter({ apiKey: this.apiKey, sender: this.sender });
        const res = await adapter.send(to, message);
        return { ...res, provider: 'kavenegar' };
      } else {
        logger.warn({ provider: this.provider }, 'Unknown SMS provider — falling back to mock');
        return { success: true, messageId: `mock-fallback-${Date.now()}`, provider: 'mock', cost: 0 };
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      logger.error({ to, provider: this.provider, error: err }, 'SMS send failed — trying fallback mock');
      return { success: false, error: err, provider: this.provider };
    }
  }

  async testConnection(): Promise<{ success: boolean; balance?: number; error?: string; provider: SmsProviderId }> {
    if (this.provider === 'mock' || !this.apiKey) {
      return { success: true, balance: 0, provider: 'mock' };
    }
    try {
      if (this.provider === 'ghasedak') {
        const adapter = new GhasedakAdapter({ apiKey: this.apiKey, sender: this.sender });
        const res = await adapter.testConnection();
        return { ...res, provider: 'ghasedak' };
      } else if (this.provider === 'kavenegar') {
        const adapter = new KavenegarAdapter({ apiKey: this.apiKey, sender: this.sender });
        const res = await adapter.testConnection();
        return { ...res, provider: 'kavenegar' };
      }
      return { success: false, error: 'Unknown provider', provider: this.provider };
    } catch (e) {
      return { success: false, error: String(e), provider: this.provider };
    }
  }

  getProvider(): SmsProviderId {
    return this.provider;
  }
}

export const smsService = new SmsService();
