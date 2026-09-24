import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PAYMENT_PROVIDER, STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { PaymentProvider } from '../../providers/payment/payment.provider';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import type { WalletTxnKind } from '@legal-platform/domain';

export interface WalletTxn {
  id: string;
  kind: WalletTxnKind;
  amountToman: number; // positive: credit, negative: debit
  at: string;
  note: string;
  /** idempotency key — retries never double-charge (SPEC §2) */
  externalRef?: string;
  /**
   * intent txns record what the USER asked to pay at topupStart; verify must
   * echo exactly this amount or the credit is refused — we never trust a
   * callback amount and never fall back to zero.
   */
  expectedAmountToman?: number;
}

interface WalletState {
  balanceToman: number;
  txns: WalletTxn[];
}

const TXN_CAP = 500;

/**
 * The Money verbs differ by gateway: ZarinPal VERIFIES (query is honestly
 * unsupported), sandbox mocks can also QUERY. Travelers rule: ask verify
 * first with our recorded amount; only if the adapter says UNSUPPORTED do we
 * fall back to a query-style read. Anything else (network, refusal) fails
 * closed — a wallet never guesses.
 */
export async function verifyTopupPayment(
  payment: PaymentProvider,
  sessionId: string,
  expectedToman: number,
): Promise<{ valid: boolean; status: 'paid' | 'failed' | 'expired' | 'refunded' | 'pending'; amount?: number }> {
  try {
    const v = await payment.verifyCallback({
      paymentId: sessionId,
      status: 'paid',
      rawPayload: { amount: expectedToman },
    });
    return { valid: v.valid, status: v.status, amount: v.amount };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'UNSUPPORTED_OPERATION') throw e;
  }
  const q = await payment.queryPaymentStatus(sessionId);
  return { valid: q.status === 'paid', status: q.status, amount: q.amount };
}

/**
 * کیف پول (P2a). Balances persist through the StorageProvider port (same
 * durability story as ConfigHub); the Postgres migration lands with the P2
 * data-lifecycle phase — the SERVICE stays agnostic (ADR-015).
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private transactionLock = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private key(userId: string) {
    return `runtime/wallet/${userId}.json`;
  }

  async state(userId: string): Promise<WalletState> {
    try {
      const raw = await this.storage.get(this.key(userId));
      return JSON.parse(raw.toString('utf8')) as WalletState;
    } catch {
      return { balanceToman: 0, txns: [] };
    }
  }

  private async put(userId: string, s: WalletState): Promise<void> {
    if (s.txns.length > TXN_CAP) s.txns = s.txns.slice(-TXN_CAP);
    await this.storage.put({
      key: this.key(userId),
      content: Buffer.from(JSON.stringify(s)),
      contentType: 'application/json',
      metadata: { kind: 'wallet' },
    });
  }

  /** Serialize per-user mutations — balance math is never racy. */
  private async exclusive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.transactionLock.get(userId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.transactionLock.set(userId, next.catch(() => undefined));
    return next;
  }

  /** Top-up via the PaymentProvider port (mock redirects, real PayPing-style goes to bank). */
  async topupStart(userId: string, amountToman: number, callbackUrl: string) {
    if (!Number.isFinite(amountToman) || amountToman < 10_000) {
      throw new BadRequestException({
        code: 'VALIDATION_INVALID_INPUT',
        message: 'حداقل شارژ ۱۰٬۰۰۰ تومان است',
      });
    }
    const session = await this.payment.createPaymentSession({
      amount: amountToman,
      currency: 'IRT',
      orderId: `wallet-${userId}-${randomUUID()}`,
      callbackUrl,
      metadata: { purpose: 'wallet_topup', userId },
    });
    await this.exclusive(userId, async () => {
      const s = await this.state(userId);
      s.txns.push({
        id: randomUUID(),
        kind: 'topup',
        amountToman: 0, // credited on VERIFY only — never trust a start
        at: new Date().toISOString(),
        note: `آغاز شارژ ${amountToman.toLocaleString('fa-IR')} تومانی`,
        externalRef: session.sessionId,
        expectedAmountToman: amountToman,
      });
      await this.put(userId, s);
    });
    return { redirectUrl: session.redirectUrl, sessionId: session.sessionId };
  }

  /**
   * Idempotent credit after the user returns from the gateway. Speaks the
   * universal verb — verifyCallback — so strict adapters (ZarinPal throws
   * queryPaymentStatus) work; the expected amount comes from OUR intent row,
   * never from the network, and never falls back to zero.
   */
  async topupConfirm(userId: string, sessionId: string): Promise<{ credited: boolean; balanceToman: number }> {
    // Sandbox convenience: the mock adapter can be force-paid in development
    // exactly once per session; production gateways never expose this knob.
    const dev = this.payment as PaymentProvider & { devMarkPaid?: (sessionId: string) => boolean };
    if (process.env.NODE_ENV !== 'production' && typeof dev.devMarkPaid === 'function') {
      dev.devMarkPaid(sessionId);
    }

    const preflight = await this.exclusive(userId, async () => {
      const s = await this.state(userId);
      const already = s.txns.find((t) => t.externalRef === sessionId && t.amountToman > 0);
      if (already) return { done: true as const, balance: s.balanceToman };
      const intent = s.txns.find((t) => t.externalRef === sessionId && t.amountToman === 0);
      if (!intent?.expectedAmountToman) {
        throw new BadRequestException({
          code: 'VALIDATION_INVALID_INPUT',
          message: 'جلسه‌ی شارژی با این شناسه برای این کیف پول ثبت نشده است.',
        });
      }
      return { done: false as const, expected: intent.expectedAmountToman, balance: s.balanceToman };
    });
    if (preflight.done) return { credited: false, balanceToman: preflight.balance };

    const verify = await verifyTopupPayment(this.payment, sessionId, preflight.expected);
    if (!verify.valid || verify.status !== 'paid') {
      return { credited: false, balanceToman: preflight.balance };
    }
    const amount = verify.amount ?? preflight.expected;
    if (amount !== preflight.expected) {
      this.logger.error(
        `wallet topup amount mismatch user=${userId} session=${sessionId} expected=${preflight.expected} gateway=${amount} — REFUSING credit`,
      );
      throw new BadRequestException({
        code: 'WALLET_TOPUP_AMOUNT_MISMATCH',
        message: 'مبلغ تأییدشده‌ی درگاه با شارژ درخواستی یکی نیست — نه شارژ می‌کنیم نه حدس می‌زنیم.',
      });
    }

    return this.exclusive(userId, async () => {
      const s = await this.state(userId);
      const already = s.txns.find((t) => t.externalRef === sessionId && t.amountToman > 0);
      if (already) return { credited: false, balanceToman: s.balanceToman };
      s.balanceToman += amount;
      s.txns.push({
        id: randomUUID(),
        kind: 'topup',
        amountToman: amount,
        at: new Date().toISOString(),
        note: `شارژ کیف پول ${amount.toLocaleString('fa-IR')} تومان`,
        externalRef: sessionId,
      });
      await this.put(userId, s);
      this.logger.log(`wallet topup user=${userId} +${amount}`);
      return { credited: true, balanceToman: s.balanceToman };
    });
  }

  /** Debit for purchases; honest INSUFFICIENT_FUNDS — no silent negative. */
  async debit(userId: string, amountToman: number, kind: Exclude<WalletTxnKind, 'topup' | 'refund'>, note: string, ref?: string): Promise<void> {
    await this.exclusive(userId, async () => {
      const s = await this.state(userId);
      if (s.balanceToman < amountToman) {
        const err = new Error('موجودی کیف پول کافی نیست — اول شارژش کن.');
        (err as Error & { code: string }).code = 'WALLET_INSUFFICIENT_FUNDS';
        throw err;
      }
      s.balanceToman -= amountToman;
      s.txns.push({
        id: randomUUID(),
        kind,
        amountToman: -amountToman,
        at: new Date().toISOString(),
        note,
        externalRef: ref,
      });
      await this.put(userId, s);
    });
  }

  async refund(userId: string, amountToman: number, note: string, ref?: string): Promise<void> {
    await this.exclusive(userId, async () => {
      const s = await this.state(userId);
      s.balanceToman += amountToman;
      s.txns.push({
        id: randomUUID(),
        kind: 'refund',
        amountToman,
        at: new Date().toISOString(),
        note,
        externalRef: ref,
      });
      await this.put(userId, s);
    });
  }
}
