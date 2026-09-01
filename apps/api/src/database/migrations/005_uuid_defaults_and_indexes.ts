// node-pg-migrate v9 is ESM-only and its top-level `types` entry is missing,
// so the type-only import needs an explicit resolution mode under Node16.
import type { MigrationBuilder } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

/**
 * Migration 005: UUID defaults and lookup indexes
 *
 * Migrations 002/003 declared `uuid` primary keys without a default, while the
 * application inserts into `otp_challenges`, `role_assignments` and
 * `audit_logs` without supplying an id. Those inserts failed a NOT NULL
 * constraint, and because AuditService swallows its errors the audit trail was
 * silently empty.
 *
 * Application code now also generates explicit ids, so this migration is
 * defence in depth rather than the only fix. Existing migrations are never
 * edited (see migrations/README.md), hence a new one.
 */

const TABLES_WITH_UUID_PK = [
  'roles',
  'role_assignments',
  'user_sessions',
  'otp_challenges',
  'audit_logs',
  'provider_configs',
  'backup_jobs',
  'restore_jobs',
  'diagnostic_runs',
  'system_notices',
  'license_records',
  'data_export_requests',
  'data_erasure_requests',
];

export const up = (pgm: MigrationBuilder) => {
  for (const table of TABLES_WITH_UUID_PK) {
    pgm.sql(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT gen_random_uuid();`);
  }

  // Supports `verifyOtp`: latest unverified login challenge for a destination.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_otp_challenges_active_lookup
      ON otp_challenges (destination, purpose, created_at DESC)
      WHERE verified_at IS NULL;
  `);

  // Supports the per-request session validation done by JwtAccessGuard.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_active
      ON user_sessions (user_id)
      WHERE revoked_at IS NULL;
  `);

  // Supports ProvidersRepository.findActiveByType().
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_provider_configs_active
      ON provider_configs (provider_type)
      WHERE is_active = TRUE;
  `);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.sql('DROP INDEX IF EXISTS idx_provider_configs_active;');
  pgm.sql('DROP INDEX IF EXISTS idx_user_sessions_active;');
  pgm.sql('DROP INDEX IF EXISTS idx_otp_challenges_active_lookup;');

  for (const table of [...TABLES_WITH_UUID_PK].reverse()) {
    pgm.sql(`ALTER TABLE ${table} ALTER COLUMN id DROP DEFAULT;`);
  }
};
