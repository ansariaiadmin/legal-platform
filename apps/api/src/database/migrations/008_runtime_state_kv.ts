import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * P9 — durable runtime state. Many first-class services (machine tokens,
 * area locks, passkeys, wizard state, brain config, deployment profile,
 * usage rollups, security reports, drafts tray) persist through the
 * StorageProvider port. This table is the pg-backed home for that port, so
 * STORAGE_DRIVER=pg turns ALL of them durable+replica-shared at once WITHOUT
 * touching their code (the ADR-011 port discipline paying rent).
 *
 * Key choice + transaction note:
 *   - one row per (tenant, key) upserted atomically (INSERT .. ON CONFLICT) —
 *     the last write wins, version checked by callers when they need CAS.
 *   - `content` is bytea so blobs (bundles, marker files) survive byte-exact.
 *   - `tenant` reserved for pooled multi-office hosting; per-deployment
 *     isolation (ADR-023) stays the blessed default: tenant='default'.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('runtime_state', {
    tenant: { type: 'text', notNull: true, default: 'default' },
    key: { type: 'text', notNull: true },
    content: { type: 'bytea', notNull: true },
    content_type: { type: 'text' },
    metadata: { type: 'jsonb' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('runtime_state', 'runtime_state_pk', { primaryKey: ['tenant', 'key'] }); // btree serves prefix scans too
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('runtime_state', { ifExists: true });
}
