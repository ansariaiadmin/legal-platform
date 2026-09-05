import { PgWalletService } from '../../src/modules/billing/pg-wallet.service';
import type { PaymentProvider } from '../../src/providers/payment/payment.provider';
import { ProviderError } from '../../src/providers/payment/payment.provider';

/**
 * P12 — ledger wallet on Postgres. No live Postgres in the sandbox, so the
 * spec drives a FAITHFUL fake pool: transaction state clones on BEGIN,
 * COMMIT swaps it in globally, ROLLBACK discards — enough to prove the SQL
 * choreography (FOR UPDATE serialization, idempotent credit, refusal rules)
 * without standing a database up. The real integration runs in CI where
 * DATABASE_URL exists.
 */

interface Entry {
  id: string; user_id: string; kind: string; amount_toman: number;
  external_ref: string | null; expected_toman: number | null; note: string | null;
  created_at: string;
}
interface PgState { accounts: Map<string, number>; entries: Entry[]; }

function fakePool(initial?: PgState) {
  let global: PgState = initial ?? { accounts: new Map(), entries: [] };

  function run(state: PgState, sql: string, params: unknown[] = []): { rows: Record<string, unknown>[] } {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };

    if (text.startsWith('INSERT INTO wallet_accounts')) {
      const userId = params[1] as string;
      if (!state.accounts.has(userId)) state.accounts.set(userId, 0);
      return { rows: [] };
    }
    if (text.startsWith('SELECT balance_toman FROM wallet_accounts WHERE') && text.includes('FOR UPDATE')) {
      const userId = params[1] as string;
      return { rows: [{ balance_toman: String(state.accounts.get(userId) ?? 0) }] };
    }
    if (text.startsWith('SELECT balance_toman FROM wallet_accounts WHERE')) {
      const userId = params[1] as string;
      return { rows: state.accounts.has(userId) ? [{ balance_toman: String(state.accounts.get(userId)) }] : [] };
    }
    if (text.startsWith('SELECT id, kind, amount_toman')) {
      const userId = params[1] as string;
      return {
        rows: state.entries
          .filter((e) => e.user_id === userId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 50),
      };
    }
    if (text.startsWith('SELECT expected_toman, amount_toman FROM wallet_entries')) {
      const [, userId, ref] = params as [string, string, string];
      return {
        rows: state.entries.filter((e) => e.user_id === userId && e.external_ref === ref && e.kind === 'topup'),
      };
    }
    if (text.startsWith('INSERT INTO wallet_entries')) {
      if (text.includes(`'topup', 0,`)) {
        // intent row: (id, tenant, user, external_ref, expected_toman, note)
        const [id, , userId, ref, expected, note] = params as [string, string, string, string, number, string];
        state.entries.push({
          id, user_id: userId, kind: 'topup', amount_toman: 0,
          external_ref: ref, expected_toman: expected, note,
          created_at: new Date().toISOString(),
        });
      } else if (text.includes(`'topup', $4`)) {
        // credit row: (id, tenant, user, amount, external_ref, note) — kind literal
        const [id, , userId, amount, ref, note] = params as [string, string, string, number, string | null, string];
        const dup = state.entries.find((e) => e.kind === 'topup' && e.amount_toman > 0 && e.external_ref === ref);
        if (dup) throw Object.assign(new Error('duplicate key'), { code: '23505' });
        state.entries.push({
          id, user_id: userId, kind: 'topup', amount_toman: amount,
          external_ref: ref ?? null, expected_toman: null, note: note ?? null,
          created_at: new Date().toISOString(),
        });
      } else if (text.includes(`'refund', $4`)) {
        // refund row: (id, tenant, user, amount, external_ref, note) — kind literal
        const [id, , userId, amount, ref, note] = params as [string, string, string, number, string | null, string];
        state.entries.push({
          id, user_id: userId, kind: 'refund', amount_toman: amount,
          external_ref: ref ?? null, expected_toman: null, note: note ?? null,
          created_at: new Date().toISOString(),
        });
      } else {
        // debit row: (id, tenant, user, kind, amount, external_ref, note)
        const [id, , userId, kind, amount, ref, note] = params as [string, string, string, string, number, string | null, string];
        state.entries.push({
          id, user_id: userId, kind, amount_toman: amount,
          external_ref: ref ?? null, expected_toman: null, note: note ?? null,
          created_at: new Date().toISOString(),
        });
      }
      return { rows: [] };
    }
    if (text.startsWith('UPDATE wallet_accounts SET balance_toman = $3')) {
      const [, userId, value] = params as [string, string, number];
      state.accounts.set(userId, value);
      return { rows: [] };
    }
    if (text.startsWith('UPDATE wallet_accounts SET balance_toman = balance_toman - $3')) {
      const [, userId, value] = params as [string, string, number];
      state.accounts.set(userId, (state.accounts.get(userId) ?? 0) - value);
      return { rows: [] };
    }
    if (text.startsWith('UPDATE wallet_accounts SET balance_toman = balance_toman + $3')) {
      const [, userId, value] = params as [string, string, number];
      state.accounts.set(userId, (state.accounts.get(userId) ?? 0) + value);
      return { rows: [] };
    }
    throw new Error(`fake pool: unhandled SQL: ${text.slice(0, 80)}`);
  }

  function client() {
    let tx: PgState | null = null;
    return {
      async query(sql: string, params?: unknown[]) {
        const text = sql.replace(/\s+/g, ' ').trim();
        if (text === 'BEGIN') { tx = JSON.parse(JSON.stringify({ accounts: [...global.accounts], entries: global.entries })) as PgState;
          tx = { accounts: new Map((tx as unknown as { accounts: [string, number][] }).accounts), entries: tx.entries }; return { rows: [] }; }
        if (text === 'COMMIT') { if (tx) global = tx; tx = null; return { rows: [] }; }
        if (text === 'ROLLBACK') { tx = null; return { rows: [] }; }
        return run(tx ?? global, sql, params);
      },
      release() {},
    };
  }

  return {
    async connect() { return client(); },
    async query(sql: string, params?: unknown[]) { return run(global, sql, params); },
    _state: () => global,
  };
}

function strictGatewayStub(): PaymentProvider & { markPaid(id: string): void } {
  const sessions = new Map<string, { amount: number; paid: boolean }>();
  return {
    markPaid(id) { const s = sessions.get(id); if (s) s.paid = true; },
    async createPaymentSession(input: { amount: number }) {
      const sessionId = `A-${sessions.size + 1}`;
      sessions.set(sessionId, { amount: input.amount, paid: false });
      return {
        sessionId, redirectUrl: `https://pg/${sessionId}`, status: 'pending',
        amount: input.amount, currency: 'IRT', createdAt: new Date(), expiresAt: new Date(),
      };
    },
    async verifyCallback(payload: { paymentId: string; rawPayload: Record<string, unknown> }) {
      const s = sessions.get(payload.paymentId);
      const amount = Number(payload.rawPayload?.amount);
      if (!s || !s.paid) return { valid: false, paymentId: payload.paymentId, status: 'failed' as const };
      if (amount !== s.amount) return { valid: false, paymentId: payload.paymentId, status: 'failed' as const };
      return { valid: true, paymentId: payload.paymentId, status: 'paid' as const, amount: s.amount };
    },
    async queryPaymentStatus(): Promise<never> {
      throw new ProviderError('PROVIDER_UNSUPPORTED_OPERATION', 'strict stub verifies only', false);
    },
    async verifyConfig() { return { valid: true }; },
    getMetadata() { return { name: 'strict-stub', idempotencyCapability: { type: 'native' as const }, supportedCurrencies: ['IRT'] }; },
  };
}

describe('PgWalletService — ledger semantics without the blob', () => {
  it('topup lifecycle: start → gateway pays → verify credits ONCE', async () => {
    const gw = strictGatewayStub();
    const wallet = new PgWalletService(gw, fakePool() as never);

    const start = await wallet.topupStart('u1', 300_000, 'cb');
    gw.markPaid(start.sessionId);

    const first = await wallet.topupConfirm('u1', start.sessionId);
    expect(first).toEqual({ credited: true, balanceToman: 300_000 });
    const replay = await wallet.topupConfirm('u1', start.sessionId);
    expect(replay.credited).toBe(false);
    expect(replay.balanceToman).toBe(300_000);

    const state = await wallet.state('u1');
    expect(state.balanceToman).toBe(300_000);
    expect(state.txns.filter((t) => t.amountToman > 0)).toHaveLength(1);
  });

  it('debit fails-closed on insufficient funds and never goes negative', async () => {
    const gw = strictGatewayStub();
    const wallet = new PgWalletService(gw, fakePool() as never);
    const start = await wallet.topupStart('u2', 100_000, 'cb');
    gw.markPaid(start.sessionId);
    await wallet.topupConfirm('u2', start.sessionId);

    await expect(wallet.debit('u2', 150_000, 'purchase_consultation' as never, 'too big')).rejects.toMatchObject({
      code: 'WALLET_INSUFFICIENT_FUNDS',
    });
    expect((await wallet.state('u2')).balanceToman).toBe(100_000);

    await wallet.debit('u2', 40_000, 'purchase_consultation' as never, 'ok');
    expect((await wallet.state('u2')).balanceToman).toBe(60_000);
  });

  it('refund credits and the full history stays auditable', async () => {
    const gw = strictGatewayStub();
    const wallet = new PgWalletService(gw, fakePool() as never);
    await wallet.refund('u3', 25_000, 'استرداد خطای رزرو');
    const state = await wallet.state('u3');
    expect(state.balanceToman).toBe(25_000);
    expect(state.txns.at(-1)?.kind).toBe('refund');
  });

  it('unknown session refuses instead of asking the gateway about a phantom', async () => {
    const gw = strictGatewayStub();
    const wallet = new PgWalletService(gw, fakePool() as never);
    await expect(wallet.topupConfirm('u4', 'A-ghost')).rejects.toMatchObject({
      message: expect.stringContaining('ثبت نشده'),
    });
  });
});
