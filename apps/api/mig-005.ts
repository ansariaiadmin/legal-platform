/**
 * Local re-creation of the CI integration migrations step WITHOUT a real
 * Postgres in this sandbox: pg-mem plays Postgres (incl. extensions support
 * via its public API), node-pg-migrate drives the real repo migrations.
 * Goal: prove up → down:all → up is idempotent & functional.
 */
import path from 'node:path';
import type { PoolClient } from 'pg';
import { runner } from 'node-pg-migrate';
import { newDb } from 'pg-mem';

async function main(): Promise<void> {
  const db = newDb();
  db.public.registerExtension('vector', () => { /* stub for pgvector ext */ });
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const client = (await pool.connect()) as unknown as PoolClient;

  const dir = path.join('/home/user/legal-platform/apps/api/src/database/migrations');
  const base = {
    dbClient: client,
    migrationsDir: dir,
    migrationFileLanguage: 'ts' as const,
    verbose: true,
    oneWay: true,
  };

  console.log('=== UP (first) ===');
  await runner({ ...base, direction: 'up', count: Infinity });
  console.log('=== DOWN:ALL ===');
  await runner({ ...base, direction: 'down', count: 100 });
  console.log('=== UP (second — idempotency) ===');
  await runner({ ...base, direction: 'up', count: Infinity });

  // Ledger invariants sanity:
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='wallet_entries' ORDER BY ordinal_position`,
  );
  console.log('wallet_entries columns:', cols.rows.map((r) => r.column_name).join(','));
  console.log('ALL MIGRATIONS OK');
  await client.release(true as never);
  await pool.end();
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err);
  process.exit(1);
});
