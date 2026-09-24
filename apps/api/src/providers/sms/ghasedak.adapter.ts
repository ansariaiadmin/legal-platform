/**
 * Ghasedak SMS Adapter — Real API — v3.1.0 — تاریکی روشن شد
 * Docs: https://ghasedak.me/docs
 * API: POST https://api.ghasedak.me/v2/sms/send/simple
 * Cost: هر پیامک ~120 تومان — اعتبار چک می‌شه
 */
import { logger } from '@/lib/logger';

export interface GhasedakConfig {
  apiKey: string;
  sender: string;
}

export class GhasedakAdapter {
  private config: GhasedakConfig;
  private baseUrl = 'https://api.ghasedak.me/v2';

  constructor(config: GhasedakConfig) {
    this.config = config;
  }

  async send(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string; cost?: number }> {
    try {
      const res = await fetch(`${this.baseUrl}/sms/send/simple`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'apikey': this.config.apiKey,
        },
        body: new URLSearchParams({
          receptor: to,
          sender: this.config.sender,
          message,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json() as any;

      if (!res.ok || data.result?.code !== 200) {
        const err = data.result?.message || `HTTP ${res.status}`;
        logger.error({ to, error: err }, 'Ghasedak SMS failed');
        return { success: false, error: err };
      }

      logger.info({ to, messageId: data.result?.items?.[0] }, 'Ghasedak SMS sent');
      return { success: true, messageId: String(data.result?.items?.[0] || Date.now()), cost: 120 };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      logger.error({ to, error: err }, 'Ghasedak SMS exception');
      return { success: false, error: err };
    }
  }

  async getBalance(): Promise<{ success: boolean; balance?: number; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/account/info`, {
        method: 'GET',
        headers: { 'apikey': this.config.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json() as any;
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true, balance: data.result?.balance || 0 };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async testConnection(): Promise<{ success: boolean; balance?: number; error?: string }> {
    return this.getBalance();
  }
}
