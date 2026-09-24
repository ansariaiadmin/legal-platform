# Database Migrations

Migrations live in `src/database/migrations/`.

> This file is deliberately **not** inside that directory. `node-pg-migrate`
> parses every file it finds there and fails with
> `Cannot determine numeric prefix for "README.md"`, which made every
> `migrate:up` - including the one `scripts/install.sh` runs - abort.

## Migration Tooling

We use `node-pg-migrate` with plain SQL migrations for deterministic, version-controlled schema changes.

### Scripts

- `npm run migrate:create <name>` - Create a new migration with timestamp prefix
- `npm run migrate:up` - Run all pending migrations (UP direction)
- `npm run migrate:down` - Rollback the last migration (DOWN direction)

### Adding a New Migration

1. Create a new migration file using:
   ```bash
   npm run migrate:create my_migration_name
   ```
   This creates a file like `001_my_migration_name.ts` with `up` and `down` functions.

2. Implement both `up()` and `down()` methods:
   - `up()`: Apply the schema change
   - `down()`: Fully reverse the change (drop tables, remove columns, etc.)

3. Migrations are executed in timestamp order. Ensure your migration number is sequential.

### Running Migrations

Migrations are automatically run during:
- Initial installation (`scripts/install.sh`)
- System updates (`scripts/update.sh`)

To manually run migrations:
```bash
# Run all pending migrations
docker compose run --rm api npm run migrate:up

# Rollback last migration
docker compose run --rm api npm run migrate:down
```

### Migration Testing

To verify migrations work correctly:
```bash
# Unit tests (no DB required)
npm test

# Integration tests against live DB (requires Docker)
npm run test:migrations
```

### Guidelines

- Every migration MUST have both `up` and `down` functions
- The `down` function must fully reverse everything done in `up`
- Use plain SQL for clarity and determinism
- Never modify existing migrations; always create new ones for changes
- Include appropriate indexes for foreign keys and commonly queried columns
- Add comments explaining complex schema changes
