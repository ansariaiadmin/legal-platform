import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { PAYMENT_PROVIDER } from '../../providers/provider.tokens';
import type { PaymentProvider } from '../../providers/payment/payment.provider';
import type { WalletTxnKind } from '@legal-platform/domain';
import { verifyTopupPayment } from './wallet.service';
import type { WalletTxn } from './wallet.service';

export interface PgWalletState {
  balanceToman: number;
  txns: WalletTxn[];
}

/**
 * P12 — Ledger wallet (FIELD REVIEW 2026-09-05 #5c).
 *
 * Same public surface as the JSON WalletService, but the pattern inverts:
 * the entry log is append-only and the balance is ROW-LOCKED with
 * `SELECT … FOR UPDATE` per mutation — so two replicas racing the same
 * user serialise in POSTGRES, not in a process-local promise chain that a
 * second replica can't even see. Unique partial index
 * `wallet_entries_topup_idem` is the idempotency wall: gateway re-verify
 * retries can never double-credit.
 *
 * Invariants carried over (ADR-028 #1):
 *  - expected amount comes from OUR intent row, never from the wire;
 *  - a paid-mismatch REFUSES credit instead of crediting a guess;
 *  - never trust starts — verification is the only credit source.
 */
@Injectable()
export class PgWalletService {
  private readonly logger = new Logger(PgWalletService.name);
  private readonly tenant = 'default'; // per-deployment isolation default (ADR-023)

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentProvider,
    private readonly pool: Pool,
  ) {}

  /* ----------------------------- reads ----------------------------- */

  async state(userId: string): Promise<PgWalletState> {
    const bal = await this.pool.query(
      `SELECT balance_toman FROM wallet_accounts WHERE tenant = $1 AND user_id = $2`,
      [this.tenant, userId],
    );
    const tx = await this.pool.query(
      `SELECT id, kind, amount_toman, external_ref, note, expected_toman, created_at
         FROM wallet_entries
        WHERE tenant = $1 AND user_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
      [this.tenant, userId],
    );
    return {
      balanceToman: Number(bal.rows[0]?.balance_toman ?? 0),
      txns: tx.rows
        .map((r: Record<string, unknown>) => ({
          id: String(r.id),
          kind: r.kind as WalletTxnKind,
          amountToman: Number(r.amount_toman),
          at: new Date(r.created_at as string).toISOString(),
          note: String(r.note ?? ''),
          externalRef: r.external_ref ? String(r.external_ref) : undefined,
          expectedAmountToman: r.expected_toman != null ? Number(r.expected_toman) : undefined,
        }))
        .reverse(),
    };
  }

  /* --------------------------- top-up flow --------------------------- */

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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureAccount(client, userId);
      await client.query(
        `INSERT INTO wallet_entries (id, tenant, user_id, kind, amount_toman, external_ref, expected_toman, note)
         VALUES ($1, $2, $3, 'topup', 0, $4, $5, $6)`,
        [
          randomUUID(), this.tenant, userId, session.sessionId, amountToman,
          `آغاز شارژ ${amountToman.toLocaleString('fa-IR')} تومانی`,
        ],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { redirectUrl: session.redirectUrl, sessionId: session.sessionId };
  }

  /** See WalletService.topupConfirm — same contract, enforced at the DB. */
  async topupConfirm(userId: string, sessionId: string): Promise<{ credited: boolean; balanceToman: number }> {
    const dev = this.payment as PaymentProvider & { devMarkPaid?: (sessionId: string) => boolean };
    if (process.env.NODE_ENV !== 'production' && typeof dev.devMarkPaid === 'function') {
      dev.devMarkPaid(sessionId);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await this.lockAccount(client, userId);

      const intent = await client.query(
        `SELECT expected_toman, amount_toman FROM wallet_entries
          WHERE tenant = $1 AND user_id = $2 AND external_ref = $3 AND kind = 'topup'`,
        [this.tenant, userId, sessionId],
      );
      if (intent.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new BadRequestException({
          code: 'VALIDATION_INVALID_INPUT',
          message: 'جلسه‌ی شارژی با این شناسه برای این کیف پول ثبت نشده است.',
        });
      }
      const creditedRow = intent.rows.find((r: { amount_toman: string }) => Number(r.amount_toman) > 0);
      if (creditedRow) {
        await client.query('COMMIT');
        return { credited: false, balanceToman: Number(account.balance_toman) };
      }
      const expected = Number((intent.rows[0] as { expected_toman: string }).expected_toman);

      // Gate + gateway verify INSIDE the lock: nobody can race a parallel
      // confirm for the same session on another replica.
      const verify = await verifyTopupPayment(this.payment, sessionId, expected);
      if (!verify.valid || verify.status !== 'paid') {
        await client.query('COMMIT');
        return { credited: false, balanceToman: Number(account.balance_toman) };
      }
      const amount = verify.amount ?? expected;
      if (amount !== expected) {
        await client.query('ROLLBACK');
        this.logger.error(
          `wallet topup amount mismatch user=${userId} session=${sessionId} expected=${expected} gateway=${amount} — REFUSING credit`,
        );
        throw new BadRequestException({
          code: 'WALLET_TOPUP_AMOUNT_MISMATCH',
          message: 'مبلغ تأییدشده‌ی درگاه با شارژ درخواستی یکی نیست — نه شارژ می‌کنیم نه حدس می‌زنیم.',
        });
      }

      await client.query(
        `INSERT INTO wallet_entries (id, tenant, user_id, kind, amount_toman, external_ref, note)
         VALUES ($1, $2, $3, 'topup', $4, $5, $6)`,
        [
          randomUUID(), this.tenant, userId, amount, sessionId,
          `شارژ کیف پول ${amount.toLocaleString('fa-IR')} تومان`,
        ],
      );
      const newBalance = Number(account.balance_toman) + amount;
      await client.query(
        `UPDATE wallet_accounts SET balance_toman = $3, updated_at = now()
          WHERE tenant = $1 AND user_id = $2`,
        [this.tenant, userId, newBalance],
      );
      await client.query('COMMIT');
      this.logger.log(`wallet topup user=${userId} +${amount}`);
      return { credited: true, balanceToman: newBalance };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    } finally {
      client.release();
    }
  }

  /* ------------------------- debit & refund -------------------------- */

  async debit(
    userId: string,
    amountToman: number,
    kind: Exclude<WalletTxnKind, 'topup' | 'refund'>,
    note: string,
    ref?: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await this.lockAccount(client, userId);
      const balance = Number(account.balance_toman);
      if (balance < amountToman) {
        await client.query('ROLLBACK');
        const err = new Error('موجودی کیف پول کافی نیست — اول شارژش کن.');
        (err as Error & { code?: string }).code = 'WALLET_INSUFFICIENT_FUNDS';
        throw err;
      }
      await client.query(
        `INSERT INTO wallet_entries (id, tenant, user_id, kind, amount_toman, external_ref, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), this.tenant, userId, kind, -amountToman, ref ?? null, note],
      );
      await client.query(
        `UPDATE wallet_accounts SET balance_toman = balance_toman - $3, updated_at = now()
          WHERE tenant = $1 AND user_id = $2`,
        [this.tenant, userId, amountToman],
      );
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* done */ }
      throw e;
    } finally {
      client.release();
    }
  }

  async refund(userId: string, amountToman: number, note: string, ref?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await this.lockAccount(client, userId);
      await client.query(
        `INSERT INTO wallet_entries (id, tenant, user_id, kind, amount_toman, external_ref, note)
         VALUES ($1, $2, $3, 'refund', $4, $5, $6)`,
        [randomUUID(), this.tenant, userId, amountToman, ref ?? null, note],
      );
      await client.query(
        `UPDATE wallet_accounts SET balance_toman = balance_toman + $3, updated_at = now()
          WHERE tenant = $1 AND user_id = $2`,
        [this.tenant, userId, amountToman],
      );
      await client.query('COMMIT');
      this.logger.log(`wallet refund user=${userId} +${amountToman} (${Number(account.balance_toman)}→${Number(account.balance_toman) + amountToman})`);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* done */ }
      throw e;
    } finally {
      client.release();
    }
  }

  /* --------------------------- internals ----------------------------- */

  private async ensureAccount(client: PoolClient, userId: string): Promise<void> {
    await client.query(
      `INSERT INTO wallet_accounts (tenant, user_id, balance_toman)
       VALUES ($1, $2, 0)
       ON CONFLICT (tenant, user_id) DO NOTHING`,
      [this.tenant, userId],
    );
  }

  /** SERIALIZE this user's money ops inside the DB — works across replicas. */
  private async lockAccount(client: PoolClient, userId: string): Promise<{ balance_toman: string }> {
    await this.ensureAccount(client, userId);
    const res = await client.query(
      `SELECT balance_toman FROM wallet_accounts
        WHERE tenant = $1 AND user_id = $2
        FOR UPDATE`,
      [this.tenant, userId],
    );
    return res.rows[0] as { balance_toman: string };
  }
}
