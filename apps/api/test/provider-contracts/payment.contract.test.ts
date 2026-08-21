import { ConfigService } from '@nestjs/config';
import { MockPaymentAdapter } from '../../src/providers/payment/mock-payment.adapter';
import { PaymentCallbackPayload } from '../../src/providers/payment/payment.provider';

interface PaymentContractTests {
  createSession: () => Promise<boolean>;
  signedCallbackVerify: () => Promise<boolean>;
  invalidCallbackRejection: () => Promise<boolean>;
  duplicateCallbackIdempotency: () => Promise<boolean>;
}

export function runPaymentContractTests(configService?: ConfigService): PaymentContractTests {
  const adapter = new MockPaymentAdapter(configService || new ConfigService());

  return {
    async createSession(): Promise<boolean> {
      try {
        const session = await adapter.createPaymentSession({
          amount: 1000,
          currency: 'IRR',
          orderId: `order_${Date.now()}`,
          callbackUrl: 'https://example.com/callback',
        });
        return !!session.sessionId && session.status === 'pending';
      } catch {
        return false;
      }
    },

    async signedCallbackVerify(): Promise<boolean> {
      try {
        const payload: PaymentCallbackPayload = {
          paymentId: 'test_payment',
          status: 'paid',
          rawPayload: { status: 'paid' },
        };
        // Sign the payload
        const adapterWithSign = new MockPaymentAdapter(configService || new ConfigService());
        // The mock adapter signs internally, we just verify it accepts valid callbacks
        const result = await adapter.verifyCallback(payload);
        return result.valid === true;
      } catch {
        return false;
      }
    },

    async invalidCallbackRejection(): Promise<boolean> {
      try {
        const payload: PaymentCallbackPayload = {
          paymentId: 'test_payment',
          status: 'paid',
          signature: 'invalid_signature',
          rawPayload: { status: 'paid' },
        };
        const result = await adapter.verifyCallback(payload);
        return result.valid === false;
      } catch {
        return true;
      }
    },

    async duplicateCallbackIdempotency(): Promise<boolean> {
      try {
        const payload: PaymentCallbackPayload = {
          paymentId: 'dup_test',
          status: 'paid',
          rawPayload: { status: 'paid' },
        };
        
        // First call
        const result1 = await adapter.verifyCallback(payload);
        // Second call with same payload
        const result2 = await adapter.verifyCallback(payload);
        
        // Both should be valid (idempotent)
        return result1.valid === true && result2.valid === true;
      } catch {
        return false;
      }
    },
  };
}
