import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * P12 — the wallet graduates from a JSON blob to a real ledger (FIELD REVIEW
 * 2026-09-05 #5c).
 *
 * Design laws this table set enforces:
 *  1. APPEND-ONLY entries: balance is a projection — never UPDATE a txn row,
 *     so auditing is native and drift is detectable.
 *  2. `SELECT … FOR UPDATE` on the wallet_accounts row serializes debits and
 *     credits ACROSS replicas — the old in-process promise chain could not.
 *  3. Idempotency by (kind, external_ref) unique constraint — the gateway's
 *     authority can retry/trust safely.
 *  4. expected_toman is recorded on intent rows so the credit step must
 *     VERIFY the same amount — never trust the wire (ADR-028 #1).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('wallet_accounts', {
    tenant: { type: 'text', notNull: true, default: 'default' },
    user_id: { type: 'text', notNull: true },
    balance_toman: { type: 'bigint', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('wallet_accounts', 'wallet_accounts_pk', { primaryKey: ['tenant', 'user_id'] });

  pgm.createTable('wallet_entries', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()') },
    tenant: { type: 'text', notNull: true, default: 'default' },
    user_id: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true }, // topup | debit_kinds | refund
    amount_toman: { type: 'bigint', notNull: true }, // >0 credit, <0 debit; =0 means pending intent
    external_ref: { type: 'text' },
    expected_toman: { type: 'bigint' },
    note: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('wallet_entries', 'wallet_entries_pk', { primaryKey: ['tenant', 'id'] });
  // Idempotent topup credit: same external_ref credited twice is impossible.
  pgm.sql(`
    CREATE UNIQUE INDEX wallet_entries_topup_idem
    ON wallet_entries (tenant, external_ref)
    WHERE kind = 'topup' AND external_ref IS NOT NULL AND amount_toman > 0;
  `);
  pgm.sql('CREATE INDEX wallet_entries_user_idx ON wallet_entries (tenant, user_id, created_at);');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('wallet_entries');
  pgm.dropTable('wallet_accounts');
}
