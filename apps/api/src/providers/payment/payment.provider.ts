import { ProviderError } from '../provider.error';

export interface PaymentSession {
  sessionId: string;
  redirectUrl?: string;
  qrCodeData?: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  amount: number;
  currency: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface PaymentCallbackPayload {
  paymentId: string;
  status: 'paid' | 'failed' | 'expired' | 'refunded';
  signature?: string;
  rawPayload: Record<string, unknown>;
}

export interface PaymentVerificationResult {
  valid: boolean;
  paymentId: string;
  status: 'paid' | 'failed' | 'expired' | 'refunded';
  amount?: number;
  error?: string;
}

export interface PaymentStatus {
  paymentId: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';
  amount?: number;
  lastUpdated: Date;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

export interface IdempotencyCapability {
  type: 'native' | 'adapter-dedup';
}

export interface PaymentProviderMetadata {
  idempotencyCapability: IdempotencyCapability;
  supportedCurrencies: string[];
  name: string;
}

export interface PaymentProvider {
  createPaymentSession(input: {
    amount: number;
    currency: string;
    orderId: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentSession>;

  verifyCallback(payload: PaymentCallbackPayload): Promise<PaymentVerificationResult>;

  queryPaymentStatus(paymentId: string): Promise<PaymentStatus>;

  refund?(input: { paymentId: string; amount?: number; reason?: string }): Promise<RefundResult>;

  verifyConfig(): Promise<{ valid: boolean; error?: string }>;

  getMetadata(): PaymentProviderMetadata;
}

export { ProviderError };
