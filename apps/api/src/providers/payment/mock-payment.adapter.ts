import { ConfigService } from '@nestjs/config';
import {
  PaymentProvider,
  PaymentSession,
  PaymentCallbackPayload,
  PaymentVerificationResult,
  PaymentStatus,
  RefundResult,
  PaymentProviderMetadata,
} from './payment.provider';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import { createHmac, randomBytes } from 'crypto';

export class MockPaymentAdapter implements PaymentProvider {
  private readonly hmacSecret: string;
  private readonly sessions: Map<string, PaymentSession & { orderId: string; metadata?: Record<string, unknown> }> = new Map();
  private readonly callbacks: Set<string> = new Set();

  constructor(private configService: ConfigService) {
    this.hmacSecret = randomBytes(32).toString('hex');
  }

  async createPaymentSession(input: {
    amount: number;
    currency: string;
    orderId: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentSession> {
    const sessionId = `mock_session_${Date.now()}_${randomBytes(8).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

    const session: PaymentSession & { orderId: string; metadata?: Record<string, unknown> } = {
      sessionId,
      redirectUrl: `https://mock-payment.example.com/pay/${sessionId}`,
      status: 'pending',
      amount: input.amount,
      currency: input.currency,
      createdAt: now,
      expiresAt,
      orderId: input.orderId,
      metadata: input.metadata,
    };

    this.sessions.set(sessionId, session);

    return {
      sessionId,
      redirectUrl: session.redirectUrl,
      status: 'pending',
      amount: input.amount,
      currency: input.currency,
      createdAt: now,
      expiresAt,
    };
  }

  async verifyCallback(payload: PaymentCallbackPayload): Promise<PaymentVerificationResult> {
    // Verify HMAC signature if present
    if (payload.signature) {
      const expectedSignature = this.signPayload(payload.rawPayload);
      if (payload.signature !== expectedSignature) {
        return {
          valid: false,
          paymentId: payload.paymentId,
          status: 'failed',
          error: 'Invalid signature',
        };
      }
    }

    // Check for duplicate callback (idempotency)
    const callbackKey = `${payload.paymentId}:${payload.status}`;
    if (this.callbacks.has(callbackKey)) {
      // Already processed - return success without re-processing
      return {
        valid: true,
        paymentId: payload.paymentId,
        status: payload.status,
      };
    }

    this.callbacks.add(callbackKey);

    return {
      valid: true,
      paymentId: payload.paymentId,
      status: payload.status,
    };
  }

  async queryPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    for (const session of this.sessions.values()) {
      if (session.sessionId === paymentId || session.orderId === paymentId) {
        return {
          paymentId: session.sessionId,
          status: session.status,
          amount: session.amount,
          lastUpdated: session.createdAt,
        };
      }
    }

    throw new ProviderError(
      PROVIDER_ERROR_CODES.NOT_FOUND,
      `Payment session not found: ${paymentId}`,
    );
  }

  async refund(input: { paymentId: string; amount?: number; reason?: string }): Promise<RefundResult> {
    const session = this.sessions.get(input.paymentId);
    if (!session) {
      return {
        success: false,
        error: 'Payment session not found',
      };
    }

    if (session.status !== 'paid') {
      return {
        success: false,
        error: 'Can only refund completed payments',
      };
    }

    return {
      success: true,
      refundId: `mock_refund_${Date.now()}`,
    };
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        error: 'Mock payment provider cannot be used in production',
      };
    }
    return { valid: true };
  }

  getMetadata(): PaymentProviderMetadata {
    return {
      name: 'Mock Payment Provider',
      idempotencyCapability: { type: 'adapter-dedup' },
      supportedCurrencies: ['IRR', 'USD', 'EUR'],
    };
  }

  private signPayload(payload: Record<string, unknown>): string {
    const data = JSON.stringify(payload, Object.keys(payload).sort());
    return createHmac('sha256', this.hmacSecret).update(data).digest('hex');
  }
}
