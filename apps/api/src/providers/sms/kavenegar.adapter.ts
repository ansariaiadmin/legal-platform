import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import type { SendSmsResult, SmsProvider } from './sms.provider';

/**
 * P9-T3 REAL SMS adapter: Kavenegar (the dominant Iranian gateway).
 * JSON over HTTPS; API key in the PATH per Kavenegar's documented contract —
 * visible in OUR logs only via redacted URL (we print path+status, key never).
 *
 * Honesty: provider message ids come back verbatim in `providerMessageId`;
 * a gateway failure is a ProviderError; verifyConfig hits the account-info
 * endpoint and reports the TRUTH.
 */
export class KavenegarSmsAdapter implements SmsProvider {
  private readonly apiKey: string;
  private readonly sender: string;
  private readonly base: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('KAVENEGAR_API_KEY')?.trim();
    if (!key) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.CONFIG_INVALID,
        'KAVENEGAR_API_KEY missing — keep SMS_ADAPTER=mock instead of fake-sending',
        false,
      );
    }
    this.apiKey = key;
    this.sender = config.get<string>('KAVENEGAR_SENDER') || '';
    // documented override seam for sandbox/probe + contract tests
    this.base = config.get<string>('KAVENEGAR_BASE_URL') || 'https://api.kavenegar.com/v1';
  }

  async sendSms(input: { phone: string; message: string }): Promise<SendSmsResult> {
    const url = `${this.base}/${this.apiKey}/sms/send.json`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          receptor: input.phone,
          message: input.message,
          ...(this.sender ? { sender: this.sender } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      let parsed: { return?: { status?: number; message?: string }; entries?: Array<{ messageid?: number }> };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        throw new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, `kavenegar non-json ${res.status}`, true);
      }
      if (!res.ok || parsed.return?.status !== 200) {
        throw new ProviderError(
          res.status === 429 ? PROVIDER_ERROR_CODES.RATE_LIMITED : PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE,
          `kavenegar refused: ${parsed.return?.message ?? res.status}`,
          res.status >= 500,
        );
      }
      const messageId = parsed.entries?.[0]?.messageid;
      if (typeof messageId !== 'number') {
        throw new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, 'kavenegar accepted without message id', true);
      }
      return { success: true, messageId: String(messageId) };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(PROVIDER_ERROR_CODES.NETWORK_ERROR, `sms send failed: ${(e as Error).message}`, true);
    }
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.base}/${this.apiKey}/account/info.json`, { signal: AbortSignal.timeout(5_000) });
      return res.ok ? { valid: true } : { valid: false, error: `status ${res.status}` };
    } catch (e) {
      return { valid: false, error: (e as Error).message };
    }
  }
}
