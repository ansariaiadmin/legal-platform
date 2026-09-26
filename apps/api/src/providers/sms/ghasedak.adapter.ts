import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import type { SendSmsResult, SmsProvider } from './sms.provider';

/**
 * Ghasedak SMS adapter (https://ghasedak.me/docs).
 *
 * Uses the current REST gateway (`/rest/api/v1/WebService/*`): JSON body,
 * API key in the `ApiKey` header. The key is never logged.
 *
 * Contract (same as every SmsProvider):
 * - success is reported only when the gateway returns `IsSuccess` and a message id;
 * - every gateway or network failure surfaces as a ProviderError;
 * - verifyConfig() calls the account-information endpoint and reports the result as-is.
 */
export class GhasedakSmsAdapter implements SmsProvider {
  private readonly apiKey: string;
  private readonly lineNumber: string;
  private readonly base: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('GHASEDAK_API_KEY')?.trim();
    if (!key) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.CONFIG_INVALID,
        'GHASEDAK_API_KEY is missing. Set it, or keep SMS_PROVIDER=mock for development.',
        false,
      );
    }
    this.apiKey = key;
    this.lineNumber = config.get<string>('GHASEDAK_LINE_NUMBER') || '';
    // Override point for sandboxes and contract tests.
    this.base = config.get<string>('GHASEDAK_BASE_URL') || 'https://gateway.ghasedak.me/rest/api/v1';
  }

  async sendSms(input: { phone: string; message: string }): Promise<SendSmsResult> {
    try {
      const res = await fetch(`${this.base}/WebService/SendSingleSMS`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ApiKey: this.apiKey },
        body: JSON.stringify({
          receptor: input.phone,
          message: input.message,
          ...(this.lineNumber ? { lineNumber: this.lineNumber } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const parsed = await readJson(res);
      const ok = pickBool(parsed, 'isSuccess');
      if (!res.ok || !ok) {
        throw new ProviderError(
          res.status === 429 ? PROVIDER_ERROR_CODES.RATE_LIMITED : PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE,
          `ghasedak refused: ${String(pickField(parsed, 'message') ?? res.status)}`,
          res.status === 429 || res.status >= 500,
        );
      }
      const data = (pickField(parsed, 'data') ?? parsed) as Record<string, unknown>;
      const messageId = pickField(data, 'messageId');
      if (messageId === undefined || messageId === null || messageId === '') {
        throw new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, 'ghasedak accepted without message id', true);
      }
      return { success: true, messageId: String(messageId) };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(PROVIDER_ERROR_CODES.NETWORK_ERROR, `sms send failed: ${(e as Error).message}`, true);
    }
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.base}/WebService/GetAccountInformation`, {
        headers: { ApiKey: this.apiKey },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return { valid: false, error: `status ${res.status}` };
      const parsed = await readJson(res);
      return pickBool(parsed, 'isSuccess') ? { valid: true } : { valid: false, error: String(pickField(parsed, 'message') ?? 'rejected') };
    } catch (e) {
      return { valid: false, error: (e as Error).message };
    }
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, `ghasedak non-json ${res.status}`, true);
  }
}

/** Ghasedak documents PascalCase fields; tolerate camelCase as well. */
function pickField(obj: Record<string, unknown> | undefined, camel: string): unknown {
  if (!obj) return undefined;
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  return obj[camel] ?? obj[pascal];
}

function pickBool(obj: Record<string, unknown>, camel: string): boolean {
  return pickField(obj, camel) === true;
}
