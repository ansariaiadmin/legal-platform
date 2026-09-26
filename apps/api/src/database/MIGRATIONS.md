# Database migrations

Migrations are TypeScript files in `src/database/migrations/`, run by [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) 9. They target PostgreSQL 16 or later with the `vector` (pgvector), `pgcrypto`, `pg_trgm` and `uuid-ossp` extensions; the `pgvector/pgvector:pg16` image used by Docker Compose provides all of them.

> This file lives outside the migrations directory on purpose: node-pg-migrate treats every file in that directory as a migration and aborts on files without a numeric prefix.

## Current migrations

| File | Contents | In use |
|---|---|---|
| `001_extensions_and_helpers` | `vector`, `pgcrypto`, `pg_trgm` extensions and helper functions | Yes |
| `002_identity_tables` | `roles`, `users`, `role_assignments`, `user_sessions`, `otp_challenges` | Yes |
| `003_ops_tables` | `audit_logs`, `provider_configs`, and job, notice, licence and data-request tables | `audit_logs` and `provider_configs` only |
| `004_add_fallback_provider` | Fallback provider column on `provider_configs` | Yes |
| `005_uuid_defaults_and_indexes` | UUID defaults and indexes | Yes |
| `006_corpus_and_billing_tables` | Relational corpus, billing, queue and notification tables | Reserved |
| `007_rag_drafts_and_usage` | `draft_requests`, `draft_reviews`, `usage_records` | Reserved |
| `008_runtime_state_kv` | `runtime_state` key-value store | Yes |
| `009_wallet_ledger` | `wallet_accounts`, `wallet_entries` (double-entry ledger) | Yes |
| `010_rag_chunks` | `rag_chunks` vector index for retrieval | Yes |

Version 1.0 keeps the corpus, purchases, queue tickets, notifications, drafts and usage records in the `runtime_state` store (through `StorageProvider`) rather than in the relational tables of migrations 006 and 007. Those tables, and the unused tables of 003, are reserved for a later move to relational storage; see `ROADMAP.md`.

## Running migrations

The installer (`scripts/install.sh`) and the updater (`scripts/update.sh`) run pending migrations automatically. To run them by hand from the repository root:

```bash
# Docker deployment
docker compose run --rm api npm run migrate:up
docker compose run --rm api npm run migrate:down      # roll back the last migration

# Local development (DATABASE_URL must be set)
npm run migrate:up
npm run migrate:down
```

## Adding a migration

1. Create the next numbered file by hand, for example `011_case_notes.ts`. Do not use `migrate:create`: it produces a timestamp prefix, while this project uses three-digit sequential numbers.
2. Export both functions:

   ```ts
   import type { MigrationBuilder } from 'node-pg-migrate';

   export async function up(pgm: MigrationBuilder): Promise<void> {
     pgm.sql(`CREATE TABLE case_notes (...);`);
   }

   export async function down(pgm: MigrationBuilder): Promise<void> {
     pgm.sql(`DROP TABLE IF EXISTS case_notes;`);
   }
   ```

3. Check that the migration applies, rolls back and applies again:

   ```bash
   npm run test:migrations -w @legal-platform/api   # up → down to zero → up
   ```

## Rules

- Never edit a migration that has been released; add a new one instead.
- `down` must fully reverse `up`.
- Prefer plain SQL through `pgm.sql` for clarity.
- Index foreign keys and frequently filtered columns.
- Comment anything non-obvious in the migration itself.
