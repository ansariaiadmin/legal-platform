import type {
  PaymentProvider,
  PaymentSession,
  PaymentCallbackPayload,
  PaymentVerificationResult,
  PaymentStatus,
  PaymentProviderMetadata,
} from '../../src/providers/payment/payment.provider';
import { ProviderError } from '../../src/providers/payment/payment.provider';
import { WalletService } from '../../src/modules/billing/wallet.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

/**
 * FIELD REVIEW 2026-09-05 finding #1: topupConfirm used queryPaymentStatus,
 * which ZarinPal throws as UNSUPPORTED_OPERATION → the entire real-gateway
 * top-up path 500'd. This spec drives the wallet with a STRICT stub shaped
 * EXACTLY like ZarinPal (verify is the only read, amount must be echoed,
 * authority is single-use) so the seam can never silently regress. The mock
 * adapter's leniency is not proof.
 */

class ZarinpalShapedStub implements PaymentProvider {
  private sessions = new Map<string, { amount: number; paidAt: string | null; verifies: number }>();
  public readonly created: { amount: number; sessionId: string }[] = [];
  readonly name = 'zarinpal-shaped-strict-stub';

  async createPaymentSession(input: { amount: number }): Promise<PaymentSession> {
    const sessionId = `A00000000000000000000000000${String(this.created.length + 1).padStart(4, '0')}`;
    this.sessions.set(sessionId, { amount: input.amount, paidAt: null, verifies: 0 });
    this.created.push({ amount: input.amount, sessionId });
    return {
      sessionId,
      redirectUrl: `https://sandbox.test/pg/StartPay/${sessionId}`,
      status: 'pending',
      amount: input.amount,
      currency: 'IRT',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
    };
  }

  /** Simulates the user paying at the real gateway (outside our control plane). */
  simulateGatewayPayment(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.paidAt = new Date().toISOString();
  }

  /** verify IS the read. Like ZarinPal: code=100 fresh, code=101 on re-verify. */
  async verifyCallback(payload: PaymentCallbackPayload): Promise<PaymentVerificationResult> {
    const amount = Number(payload.rawPayload?.amount);
    const s = this.sessions.get(payload.paymentId);
    if (!s || !Number.isInteger(amount) || amount <= 0) {
      return { valid: false, paymentId: payload.paymentId, status: 'failed', error: 'no such authority/amount' };
    }
    if (!s.paidAt) {
      return { valid: false, paymentId: payload.paymentId, status: 'failed', error: 'authority never paid (gateway code=-21)' };
    }
    if (amount !== s.amount) {
      return { valid: false, paymentId: payload.paymentId, status: 'failed', error: 'amount mismatch (gateway code=-22)' };
    }
    const alreadyVerified = s.verifies > 0;
    s.verifies += 1;
    // code=100 first, 101 on repeat — both mean PAID, idempotency is the gateway's.
    return { valid: true, paymentId: payload.paymentId, status: 'paid', amount: s.amount };
  }

  async queryPaymentStatus(): Promise<PaymentStatus> {
    throw new ProviderError('UNSUPPORTED_OPERATION' as never, 'queryPaymentStatus: ZarinPal-shaped stub verifies', false);
  }

  getMetadata(): PaymentProviderMetadata {
    return { name: this.name, idempotencyCapability: { type: 'native' }, supportedCurrencies: ['IRT'] };
  }
  async verifyConfig() {
    return { valid: true };
  }
}

function memoryStorage(): StorageProvider & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put({ key, content }: { key: string; content: Buffer }) {
      files.set(key, Buffer.from(content));
      return { key, size: content.length } as never;
    },
    async get(key: string) {
      const found = files.get(key);
      if (!found) throw new Error('not found');
      return found;
    },
    async delete(key: string) {
      files.delete(key);
    },
    async exists(key: string) {
      return files.has(key);
    },
    async list() {
      return [];
    },
  } as never;
}

describe('wallet topup × strict gateway (ZarinPal-shaped) contract', () => {
  it('credits via verifyCallback ONLY — queryPaymentStatus unsupported must not break topup', async () => {
    const payment = new ZarinpalShapedStub(); // no devMarkPaid → prod-parity flow even in NODE_ENV=test
    const wallet = new WalletService(payment as never, memoryStorage() as never);

    const start = await wallet.topupStart('lawyer-1', 250_000, 'https://app.test/client/wallet/verify');
    payment.simulateGatewayPayment(start.sessionId);

    const confirmed = await wallet.topupConfirm('lawyer-1', start.sessionId);
    expect(confirmed).toEqual({ credited: true, balanceToman: 250_000 });

    const state = await wallet.state('lawyer-1');
    expect(state.balanceToman).toBe(250_000);
  });

  it('is idempotent under gateway-native re-verify (code=101 semantics)', async () => {
    const payment = new ZarinpalShapedStub();
    const wallet = new WalletService(payment as never, memoryStorage() as never);
    const start = await wallet.topupStart('lawyer-2', 100_000, 'cb');
    payment.simulateGatewayPayment(start.sessionId);

    const first = await wallet.topupConfirm('lawyer-2', start.sessionId);
    const retry = await wallet.topupConfirm('lawyer-2', start.sessionId);
    expect(first.credited).toBe(true);
    expect(retry.credited).toBe(false);
    expect((await wallet.state('lawyer-2')).balanceToman).toBe(100_000);
  });

  it('refuses to credit a session the user never PAID at the gateway', async () => {
    const payment = new ZarinpalShapedStub();
    const wallet = new WalletService(payment as never, memoryStorage() as never);
    const start = await wallet.topupStart('lawyer-3', 500_000, 'cb');

    const result = await wallet.topupConfirm('lawyer-3', start.sessionId);
    expect(result.credited).toBe(false);
    expect((await wallet.state('lawyer-3')).balanceToman).toBe(0);
  });

  it('rejects an unknown sessionId instead of verifying a phantom', async () => {
    const payment = new ZarinpalShapedStub();
    const wallet = new WalletService(payment as never, memoryStorage() as never);
    await expect(wallet.topupConfirm('lawyer-4', 'A0000-phantom')).rejects.toMatchObject({
      message: expect.stringContaining('ثبت نشده'),
    });
  });

  it('never credits an amount it did not record at start (no ?? 0, no trusting the wire)', async () => {
    const payment = new ZarinpalShapedStub();
    const wallet = new WalletService(payment as never, memoryStorage() as never);
    const start = await wallet.topupStart('lawyer-5', 750_000, 'cb');
    payment.simulateGatewayPayment(start.sessionId);
    // tampering gateway: says PAID but reports a different amount back
    const tamper = payment as unknown as { verifyCallback: (p: never) => Promise<never> };
    const original = payment.verifyCallback.bind(payment);
    tamper.verifyCallback = (async (p: Parameters<typeof original>[0]) => {
      const r = await original(p);
      return r.valid ? { ...r, amount: 75_000 } : r;
    }) as never;

    await expect(wallet.topupConfirm('lawyer-5', start.sessionId)).rejects.toMatchObject({
      message: expect.stringContaining('یکی نیست'),
    });
    expect((await wallet.state('lawyer-5')).balanceToman).toBe(0); // refused, not credited, not guessed
  });
});
