import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import type {
  StorageListResult,
  StorageProvider,
  StorageProviderMetadata,
} from './storage.provider';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * P9-T2 — one rule for both drivers: a well-formed TENANT_SLUG or a loud
 * refusal. Used by the pg adapter (tenant column) AND the scoping wrapper
 * (key prefix); the single RE keeps their namespaces compatible forever.
 */
export function assertTenantSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.CONFIG_INVALID,
      `illegal TENANT_SLUG ${JSON.stringify(slug)} — lowercase letters/digits/hyphens, 1–63 chars, starts alnum`,
      false,
    );
  }
  return slug;
}

/**
 * P9-T2 — tenant key-scoping decorator over ANY StorageProvider. Per-office
 * deployments put `t/<slug>/` between their data and any other office's,
 * byte-identical on write AND read AND list. This makes host-level backup
 * restores and accidental volume sharing FAIL VISIBLY (ENOENT per office)
 * instead of silently cross-reading another office's secret machine tokens.
 *
 * The caller-facing contract (keys in/out of list) hides the prefix; the
 * wrapped provider sees only scoped keys.
 */
export class TenantScopedStorageAdapter implements StorageProvider {
  readonly slug: string;

  constructor(
    private readonly inner: StorageProvider,
    slug: string,
  ) {
    this.slug = assertTenantSlug(slug);
  }

  private scoped(key: string): string {
    return `t/${this.slug}/${key}`;
  }

  async put(input: Parameters<StorageProvider['put']>[0]) {
    const res = await this.inner.put({ ...input, key: this.scoped(input.key) });
    return { url: res.url, key: input.key };
  }

  get(key: string): Promise<Buffer> {
    return this.inner.get(this.scoped(key));
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(this.scoped(key));
  }

  async list(input: { prefix?: string; cursor?: string; limit?: number }): Promise<StorageListResult> {
    const scope = `t/${this.slug}/`;
    const res = await this.inner.list({
      prefix: scope + (input.prefix ?? ''),
      cursor: input.cursor ? scope + input.cursor : undefined,
      limit: input.limit,
    });
    return {
      objects: res.objects.map((o) => ({ ...o, key: o.key.startsWith(scope) ? o.key.slice(scope.length) : o.key })),
      nextCursor: res.nextCursor?.startsWith(scope) ? res.nextCursor.slice(scope.length) : res.nextCursor,
      hasMore: res.hasMore,
    };
  }

  verifyConfig() {
    return this.inner.verifyConfig();
  }

  getMetadata(): StorageProviderMetadata {
    const m = this.inner.getMetadata();
    return { ...m, name: `${m.name}@tenant:${this.slug}` };
  }
}
