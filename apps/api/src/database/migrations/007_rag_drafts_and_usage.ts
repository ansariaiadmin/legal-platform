import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * P4 — SQL shapes for the drafting + metering layers:
 *   draft_requests — state machine w/ provenance bundle (jsonb), supersede link
 *   draft_reviews  — per review (approve/reject) by whom, when, why
 *   usage_records  — per (month, feature, model) token/cost rollups (mirror of
 *                    the StorageProvider rollup, production-honest)
 *
 * Notably no private content churn enters logs: output text IS the draft,
 * held row-scoped, only the OWNER reads prompts via the API.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  pgm.createTable('draft_requests', {
    draft_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    state: {
      type: 'text',
      notNull: true,
      check: "state in ('created','retrieving','generating','awaiting_review','approved','rejected','superseded','failed')",
    },
    prompt: { type: 'text', notNull: true },
    output: { type: 'text', notNull: true, default: '' },
    provenance: { type: 'jsonb' }, // query, retrieved[], model, usage — the bundle
    created_by: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    reviewed_by: { type: 'text' },
    reviewed_at: { type: 'timestamptz' },
    supersedes_id: { type: 'uuid', references: 'draft_requests(draft_id)' },
    error: { type: 'text' },
  });
  pgm.createIndex('draft_requests', ['state']);
  pgm.createIndex('draft_requests', ['created_by', 'state']);

  pgm.createTable('draft_reviews', {
    review_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    draft_id: {
      type: 'uuid',
      notNull: true,
      references: 'draft_requests(draft_id)',
      onDelete: 'CASCADE',
    },
    action: { type: 'text', notNull: true, check: "action in ('approve','reject','supersede')" },
    by_user_id: { type: 'text', notNull: true },
    reason: { type: 'text' },
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('draft_reviews', ['draft_id']);

  pgm.createTable('usage_records', {
    usage_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    month_key: { type: 'text', notNull: true }, // YYYY-MM
    feature: { type: 'text', notNull: true }, // tiebreak | drafting | embedding
    model: { type: 'text', notNull: true },
    requests: { type: 'integer', notNull: true, default: 0 },
    tokens: { type: 'bigint', notNull: true, default: 0 },
    cost_usd: { type: 'numeric(12, 6)' }, // null when pricing unconfigured — never invented
    user_id: { type: 'text' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('usage_records', 'usage_rollup_unique', 'UNIQUE(month_key, feature, model)');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('usage_records');
  pgm.dropTable('draft_reviews');
  pgm.dropTable('draft_requests');
}
