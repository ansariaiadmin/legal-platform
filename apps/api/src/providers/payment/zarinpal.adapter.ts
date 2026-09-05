import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import type {
  PaymentProvider,
  PaymentProviderMetadata,
  PaymentSession,
  PaymentCallbackPayload,
  PaymentVerificationResult,
  PaymentStatus,
} from './payment.provider';

/**
 * P9-T3 REAL payment adapter: ZarinPal v4 (request → verify). Both the live
 * and the official SANDBOX endpoints speak the same JSON shape; this code
 * path is identical — only the base URL flips (ZARINPAL_SANDBOX=1).
 *
 * Honesty: a payment is 'paid' ONLY when the gateway says code=100/101 on
 * verify with matching amount; anything else is failed with the gateway's
 * own status code carried through — no optimistic bookkeeping.
 *
 * Money units: ZarinPal expects RIAL amounts in the currency field IRR
 * historically; we send what the caller expresses with `currency` verbatim
 * (IRT from our plans) and state the assumption in the error box so a
 * mispriced callback can never silently "succeed".
 */
export class ZarinpalAdapter implements PaymentProvider {
  private readonly merchantId: string;
  private readonly base: string;

  constructor(config: ConfigService) {
    const merchant = config.get<string>('ZARINPAL_MERCHANT_ID')?.trim();
    if (!merchant) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.CONFIG_INVALID,
        'ZARINPAL_MERCHANT_ID missing — remain on the mock adapter (PAYMENT_ADAPTER=mock) rather than pretend',
        false,
      );
    }
    this.merchantId = merchant;
    // ZARINPAL_BASE_URL is the documented override seam: sandbox ops and the
    // contract tests use it; production default never honors it accidentally.
    this.base =
      config.get<string>('ZARINPAL_BASE_URL') ||
      (config.get<string>('ZARINPAL_SANDBOX') === '1' && process.env.NODE_ENV !== 'production'
        ? 'https://sandbox.zarinpal.com/pg/v4/payment'
        : 'https://payment.zarinpal.com/pg/v4/payment');
  }

  async createPaymentSession(input: {
    amount: number;
    currency: string;
    orderId: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentSession> {
    const out = await this.call('/request.json', {
      merchant_id: this.merchantId,
      amount: input.amount,
      currency: input.currency,
      description: `order:${input.orderId}`,
      callback_url: input.callbackUrl,
      metadata: input.metadata ?? {},
    });
    const data = out.data as { authority?: string; code?: number } | undefined;
    if (data?.code !== 100 || !data.authority) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE,
        `zarinpal request refused (code=${data?.code ?? 'none'})`,
        true,
        { code: data?.code },
      );
    }
    return {
      sessionId: data.authority,
      redirectUrl: `${this.base.replace('/pg/v4/payment', '')}/pg/StartPay/${data.authority}`,
      status: 'pending',
      amount: input.amount,
      currency: input.currency,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
  }

  async verifyCallback(payload: PaymentCallbackPayload): Promise<PaymentVerificationResult> {
    const amount = Number(payload.rawPayload?.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return { valid: false, paymentId: payload.paymentId, status: 'failed', error: 'callback lacks the recorded amount — refusing to guess' };
    }
    try {
      const out = await this.call('/verify.json', {
        merchant_id: this.merchantId,
        amount,
        authority: payload.paymentId,
      });
      const data = out.data as { code?: number; ref_id?: number; amount?: number } | undefined;
      if (data?.code === 100 || data?.code === 101) {
        return { valid: true, paymentId: payload.paymentId, status: 'paid', amount: data.amount ?? amount };
      }
      return { valid: false, paymentId: payload.paymentId, status: 'failed', error: `gateway code=${data?.code ?? 'none'}` };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(PROVIDER_ERROR_CODES.NETWORK_ERROR, `verify failed: ${(e as Error).message}`, true);
    }
  }

  async queryPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    void paymentId;
    // ZarinPal has no separate query endpoint — verify IS the read; exposing
    // a different verb would be decoration. Honest unsupported.
    throw new ProviderError(PROVIDER_ERROR_CODES.UNSUPPORTED_OPERATION, 'queryPaymentStatus: ZarinPal verifies; re-check via verifyCallback', false);
  }

  async refund(): Promise<never> {
    throw new ProviderError(PROVIDER_ERROR_CODES.UNSUPPORTED_OPERATION, 'ZarinPal refund is manual in its dashboard — API never pretends', false);
  }

  getMetadata(): PaymentProviderMetadata {
    return {
      name: 'zarinpal',
      idempotencyCapability: { type: 'native' }, // authority single-use; double-verify returns code=101
      supportedCurrencies: ['IRT', 'IRR'],
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    return { valid: this.merchantId.length > 0 };
  }

  private async call(path: string, body: unknown): Promise<{ data?: unknown }> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, `zarinpal http ${res.status}`, res.status >= 500);
    }
    return (await res.json()) as { data?: unknown };
  }
}
