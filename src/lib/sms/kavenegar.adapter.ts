/**
 * Kavenegar SMS Adapter — Real API — v3.1.0 — تاریکی روشن شد
 * Docs: https://kavenegar.com/rest.html
 * Cost: هر پیامک ~110 تومان
 */
import { logger } from '@/lib/logger';

export interface KavenegarConfig {
  apiKey: string;
  sender: string;
}

export class KavenegarAdapter {
  private config: KavenegarConfig;

  constructor(config: KavenegarConfig) {
    this.config = config;
  }

  async send(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string; cost?: number }> {
    try {
      const url = `https://api.kavenegar.com/v1/${this.config.apiKey}/sms/send.json`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          receptor: to,
          sender: this.config.sender,
          message,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json() as any;

      if (!res.ok || data.return?.status !== 200) {
        const err = data.return?.message || `HTTP ${res.status}`;
        logger.error({ to, error: err }, 'Kavenegar SMS failed');
        return { success: false, error: err };
      }

      logger.info({ to, messageId: data.entries?.[0]?.messageid }, 'Kavenegar SMS sent');
      return { success: true, messageId: String(data.entries?.[0]?.messageid || Date.now()), cost: 110 };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      logger.error({ to, error: err }, 'Kavenegar SMS exception');
      return { success: false, error: err };
    }
  }

  async getBalance(): Promise<{ success: boolean; balance?: number; error?: string }> {
    try {
      const url = `https://api.kavenegar.com/v1/${this.config.apiKey}/account/info.json`;
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      const data = await res.json() as any;
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true, balance: data.entries?.remaincredit || 0 };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async testConnection(): Promise<{ success: boolean; balance?: number; error?: string }> {
    return this.getBalance();
  }
}
