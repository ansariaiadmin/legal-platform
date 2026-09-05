import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import { assertTenantSlug } from './tenant-scoped-storage.adapter';
import type {
  StorageListResult,
  StorageObject,
  StorageProvider,
  StorageProviderMetadata,
} from './storage.provider';

/**
 * P9-T1 — Postgres-backed StorageProvider. One process-global implementation
 * swap (STORAGE_DRIVER=pg) turns EVERY persisted runtime service durable and
 * replica-shared: machine tokens, area locks, passkeys, wizard, profiles,
 * usage, reports — all of it, because they all sit behind the same port
 * (ADR-011 discipline paying for itself).
 *
 * Semantics, honestly:
 *  - put = single-statement atomic upsert (ON CONFLICT). Not a multi-row
 *    transaction: services that need CAS stay honest about it (none today).
 *  - list walks key prefix with SQL `LIKE` over (tenant,key) and uses
 *    key-cursor pagination — deterministic order, no limit-100 cliff.
 *  - bytea round-trips Buffer exactly; texts stored as UTF-8 bytes.
 *  - All errors surface as ProviderError with codes — a DOWN database is a
 *    loud failure, never a fake empty list (the file adapter's lying trap).
 */
export class PgStorageAdapter implements StorageProvider {
  private readonly pool: Pool;
  private readonly tenant: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('DATABASE_URL');
    if (!url) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.CONFIG_INVALID,
        'STORAGE_DRIVER=pg requires DATABASE_URL — else pick STORAGE_DRIVER=local honestly',
        false,
      );
    }
    // P9-T2: slug validated BEFORE the pool exists — a bogus slug is a
    // config error with zero side effects, not a half-open connection.
    this.tenant = assertTenantSlug(config.get<string>('TENANT_SLUG') || 'default');
    this.pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10_000 });
  }

  async put(input: {
    key: string;
    content: Buffer | string;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; key: string }> {
    this.assertKey(input.key);
    const buf = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content ?? '', 'utf8');
    try {
      await this.pool.query(
        `INSERT INTO runtime_state (tenant, key, content, content_type, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (tenant, key)
         DO UPDATE SET content = EXCLUDED.content,
                       content_type = EXCLUDED.content_type,
                       metadata = EXCLUDED.metadata,
                       updated_at = now()`,
        [this.tenant, input.key, buf, input.contentType ?? null, input.metadata ? JSON.stringify(input.metadata) : null],
      );
      return { url: `pg://runtime_state/${this.tenant}/${input.key}`, key: input.key };
    } catch (e) {
      throw this.wrapQueryError('put', e);
    }
  }

  async get(key: string): Promise<Buffer> {
    this.assertKey(key);
    try {
      const res = await this.pool.query(
        'SELECT content FROM runtime_state WHERE tenant = $1 AND key = $2',
        [this.tenant, key],
      );
      if (res.rows.length === 0) {
        const err = new Error(`key not found: ${key}`);
        (err as Error & { code?: string }).code = 'ENOENT';
        throw err;
      }
      return Buffer.from(res.rows[0].content as Buffer);
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') throw e;
      throw this.wrapQueryError('get', e);
    }
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    try {
      await this.pool.query('DELETE FROM runtime_state WHERE tenant = $1 AND key = $2', [this.tenant, key]);
    } catch (e) {
      throw this.wrapQueryError('delete', e);
    }
  }

  async list(input: { prefix?: string; cursor?: string; limit?: number }): Promise<StorageListResult> {
    const limit = Math.min(input.limit ?? 1000, 10_000);
    try {
      const res = await this.pool.query(
        `SELECT key, octet_length(content) AS size, updated_at FROM runtime_state
         WHERE tenant = $1
           AND ($2::text IS NULL OR key LIKE $2 || '%')
           AND ($3::text IS NULL OR key > $3)
         ORDER BY key ASC
         LIMIT $4`,
        [this.tenant, input.prefix ?? null, input.cursor ?? null, limit + 1],
      );
      const rows = res.rows as Array<{ key: string; size: number; updated_at: Date }>;
      const page = rows.slice(0, limit);
      return {
        objects: page.map((r): StorageObject => ({ key: r.key, size: Number(r.size), lastModified: r.updated_at })),
        nextCursor: rows.length > limit ? page[page.length - 1].key : undefined,
        hasMore: rows.length > limit,
      };
    } catch (e) {
      throw this.wrapQueryError('list', e);
    }
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { valid: true };
    } catch (e) {
      return { valid: false, error: (e as Error).message };
    }
  }

  getMetadata(): StorageProviderMetadata {
    return { name: 'pg-runtime_state', driverType: 'local', maxFileSize: 64 * 1024 * 1024 };
  }

  private assertKey(key: string): void {
    if (!key || key.length > 512 || /[\x00-\x1f]/.test(key)) {
      throw new ProviderError(PROVIDER_ERROR_CODES.CONFIG_INVALID, `illegal storage key: ${JSON.stringify(key).slice(0, 80)}`, false);
    }
  }

  private wrapQueryError(op: string, e: unknown): ProviderError | Error {
    const msg = (e as Error)?.message ?? String(e);
    if (/relation "runtime_state" does not exist/i.test(msg)) {
      return new ProviderError(
        PROVIDER_ERROR_CODES.CONFIG_INVALID,
        'runtime_state table missing — run `npm run migrate:up` (migration 008_runtime_state_kv)',
        false,
        { op },
      );
    }
    return new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, `pg storage ${op} failed: ${msg}`, true, { op });
  }
}
