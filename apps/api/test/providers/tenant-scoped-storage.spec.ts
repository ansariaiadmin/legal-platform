/**
 * P9-T2 contract tests: tenant scoping wrapper over an in-memory provider.
 * No fake greens: the inner provider is a faithful StorageProvider
 * implementation the test fully controls — the same seam discipline as T3.
 */
import { TenantScopedStorageAdapter, assertTenantSlug } from '../../src/providers/storage/tenant-scoped-storage.adapter';
import type { StorageProvider, StorageListResult } from '../../src/providers/storage/storage.provider';
import { ProviderError, PROVIDER_ERROR_CODES } from '../../src/providers/provider.error';

/** Faithful in-memory StorageProvider — honors prefix + cursor semantics. */
class MemStorage implements StorageProvider {
  readonly kv = new Map<string, Buffer>();
  async put(input: { key: string; content: Buffer | string }) {
    this.kv.set(input.key, Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8'));
    return { url: `mem://${input.key}`, key: input.key };
  }
  async get(key: string): Promise<Buffer> {
    const v = this.kv.get(key);
    if (!v) {
      const err = new Error(`key not found: ${key}`);
      (err as any).code = 'ENOENT';
      throw err;
    }
    return v;
  }
  async delete(key: string) { this.kv.delete(key); }
  async list(input: { prefix?: string; cursor?: string; limit?: number }): Promise<StorageListResult> {
    const keys = [...this.kv.keys()]
      .filter((k) => (!input.prefix || k.startsWith(input.prefix)) && (!input.cursor || k > input.cursor))
      .sort();
    const limit = input.limit ?? 1000;
    const page = keys.slice(0, limit);
    return {
      objects: page.map((k) => ({ key: k, size: this.kv.get(k)!.length, lastModified: new Date() })),
      nextCursor: keys.length > limit ? page[page.length - 1] : undefined,
      hasMore: keys.length > limit,
    };
  }
  async verifyConfig() { return { valid: true }; }
  getMetadata() { return { name: 'mem', driverType: 'local' as const }; }
}

describe('P9-T2 TenantScopedStorageAdapter', () => {
  let mem: MemStorage;
  let officeA: TenantScopedStorageAdapter;
  let officeB: TenantScopedStorageAdapter;

  beforeEach(() => {
    mem = new MemStorage();
    officeA = new TenantScopedStorageAdapter(mem, 'tehran-west');
    officeB = new TenantScopedStorageAdapter(mem, 'mashhad');
  });

  it('isolates identical logical keys by office — byte-for-byte', async () => {
    await officeA.put({ key: 'runtime/security/token.json', content: 'SECRET_A' });
    await officeB.put({ key: 'runtime/security/token.json', content: 'SECRET_B' });
    expect((await officeA.get('runtime/security/token.json')).toString()).toBe('SECRET_A');
    expect((await officeB.get('runtime/security/token.json')).toString()).toBe('SECRET_B');
    expect(mem.kv.get('t/tehran-west/runtime/security/token.json')!.toString()).toBe('SECRET_A');
  });

  it('a cross-office key does not even EXIST for the other office (ENOENT honesty)', async () => {
    await officeA.put({ key: 'wizard/state.json', content: '{}' });
    await expect(officeB.get('wizard/state.json')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('list only returns the office’s own keys, prefix applied after scoping', async () => {
    await officeA.put({ key: 'a/1.txt', content: '1' });
    await officeA.put({ key: 'a/2.txt', content: '2' });
    await officeB.put({ key: 'a/b-only.txt', content: 'b' });
    const resA = await officeA.list({ prefix: 'a/' });
    expect(resA.objects.map((o) => o.key).sort()).toEqual(['a/1.txt', 'a/2.txt']);
    const resB = await officeB.list({ prefix: 'a/' });
    expect(resB.objects.map((o) => o.key)).toEqual(['a/b-only.txt']);
  });

  it('cursor pagination stays correct across the scope boundary', async () => {
    for (let i = 0; i < 5; i++) {
      await officeA.put({ key: `page/${String(i).padStart(2, '0')}`, content: 'x' });
    }
    const p1 = await officeA.list({ prefix: 'page/', limit: 2 });
    expect(p1.hasMore).toBe(true);
    const p2 = await officeA.list({ prefix: 'page/', limit: 2, cursor: p1.nextCursor });
    expect(p1.objects[0].key.startsWith('page/')).toBe(true);
    expect(p2.objects[0].key > p1.nextCursor!).toBe(true);
  });

  it('delete only removes within the scope', async () => {
    await officeA.put({ key: 'del', content: 'a' });
    await officeB.put({ key: 'del', content: 'b' });
    await officeA.delete('del');
    await expect(officeA.get('del')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await officeB.get('del')).toString()).toBe('b');
  });

  it.each(['Office X', 'teh ran', '-leading', 'UPPER', 'x'.repeat(64), 'dot.com', '../evil'])(
    'rejects illegal slug %j loudly (CONFIG_INVALID, non-retryable)',
    (bad) => {
      expect(() => assertTenantSlug(bad)).toThrow(ProviderError);
      try { assertTenantSlug(bad); } catch (e) {
        expect((e as ProviderError).code).toBe(PROVIDER_ERROR_CODES.CONFIG_INVALID);
        expect((e as ProviderError).retryable).toBe(false);
      }
    },
  );

  it('metadata names the tenant so ops output can never hide the scope', () => {
    expect(officeA.getMetadata().name).toBe('mem@tenant:tehran-west');
  });
});
