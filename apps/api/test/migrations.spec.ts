import * as fs from 'fs';
import * as path from 'path';

const migrationsDir = path.join(__dirname, '../src/database/migrations');

const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((file) => /^\d{3}_.+\.ts$/.test(file))
  .sort();

const read = (file: string): string => fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

describe('Database migrations', () => {
  it('finds at least one migration', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it('numbers every migration sequentially and uniquely', () => {
    const numbers = migrationFiles.map((file) => Number.parseInt(file.split('_')[0], 10));

    expect(new Set(numbers).size).toBe(numbers.length);
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
    }
  });

  it('every uuid-PK table declares its primary key (CI caught 006 missing PKs on real PG)', () => {
    // Regression: migration 006 created 12 tables with `id: {type:'uuid', notNull:true}`
    // but NO primaryKey, then referenced those ids via FK → Postgres rejects the FK
    // with "no unique constraint matching given keys". Unit suites never noticed because
    // they stub the pool. Guard statically here AND with the real-PG e2e in CI.
    for (const file of migrationFiles) {
      const source = read(file);
      const tableBlocks = source.split(/pgm\.createTable\('/).slice(1);
      for (const block of tableBlocks) {
        const tableName = block.slice(0, block.indexOf("'"));
        const blockEnd = Math.min(block.indexOf('});'), block.length);
        const body = block.slice(0, blockEnd);
        const hasBareUuidId = /id:\s*\{[^}]*type:\s*'uuid'[^}]*notNull:\s*true[^}]*\}/.test(body)
          && !/id:\s*\{[^}]*primaryKey:\s*true/.test(body);
        if (!hasBareUuidId) {
          continue;
        }
        const tableLevelPk = /primaryKey:\s*\[/.test(block.slice(0, block.indexOf('\n  );\n')));
        expect({ file, table: tableName, ok: tableLevelPk }).toEqual({ file, table: tableName, ok: true });
      }
    }
  });

  /**
   * The previous version of this test grepped for `export const up:` with a
   * colon, which no migration ever used - so it failed on every file. Importing
   * the module checks the real contract: both hooks must be callable.
   */
  it.each(migrationFiles)('%s exports callable up() and down() hooks', (file) => {
    // `require`, not `await import()`: ts-jest runs in a CommonJS VM where a
    // dynamic import needs --experimental-vm-modules.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const migration = require(path.join(migrationsDir, file)) as { up?: unknown; down?: unknown };

    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('001 installs pgvector, pgcrypto and the updated_at trigger helper', () => {
    const content = read('001_extensions_and_helpers.ts');

    expect(content).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(content).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    expect(content).toContain('set_updated_at');
  });

  it('002 creates the identity tables and seeds all four roles', () => {
    const content = read('002_identity_tables.ts');

    for (const table of ['roles', 'users', 'role_assignments', 'user_sessions', 'otp_challenges']) {
      expect(content).toContain(`createTable('${table}'`);
    }
    for (const role of ['lawyer_owner', 'staff', 'client', 'operator']) {
      expect(content).toContain(role);
    }
  });

  it('003 creates the ops tables', () => {
    const content = read('003_ops_tables.ts');

    for (const table of [
      'audit_logs',
      'provider_configs',
      'backup_jobs',
      'restore_jobs',
      'diagnostic_runs',
      'system_notices',
      'license_records',
      'data_export_requests',
      'data_erasure_requests',
    ]) {
      expect(content).toContain(`createTable('${table}'`);
    }
  });

  it('004 adds the fallback provider reference', () => {
    const content = read('004_add_fallback_provider.ts');

    expect(content).toContain('fallback_provider_config_id');
    expect(content).toContain('REFERENCES provider_configs(id)');
  });

  /**
   * Migrations 002/003 declared uuid primary keys with no default while the
   * application inserts without an id, which silently emptied the audit trail.
   */
  it('005 gives every uuid primary key a gen_random_uuid() default', () => {
    const content = read('005_uuid_defaults_and_indexes.ts');

    expect(content).toContain('gen_random_uuid()');
    for (const table of ['roles', 'audit_logs', 'otp_challenges', 'role_assignments', 'provider_configs']) {
      expect(content).toContain(`'${table}'`);
    }
    expect(content).toContain('DROP DEFAULT');
  });
});
