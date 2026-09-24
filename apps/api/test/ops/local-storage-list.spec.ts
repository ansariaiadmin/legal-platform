import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalStorageAdapter } from '../../src/providers/storage/local-storage.adapter';

/**
 * P7 found-in-the-wild regression: `list()` used to read ONLY the top-level
 * directory, silently omitting nested runtime keys (runtime/security/…),
 * which made an honest backup service report an EMPTY bundle over a non-empty
 * store. This pins: nesting is walked, key-prefix filtering is key-based.
 */
describe('local storage adapter — nested listing fidelity', () => {
  it('list() surfaces nested keys and respects key prefixes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lp-store-'));
    try {
      const adapter = new LocalStorageAdapter(new ConfigService({ LOCAL_STORAGE_PATH: dir }));
      await adapter.put({ key: 'top.json', content: Buffer.from('{}') });
      await adapter.put({ key: 'runtime/security/reports.json', content: Buffer.from('[]') });
      await adapter.put({ key: 'runtime/machine-tokens/store.json', content: Buffer.from('{}') });

      const all = await adapter.list({ limit: 100 });
      expect(all.objects.map((o) => o.key).sort()).toEqual([
        'runtime/machine-tokens/store.json',
        'runtime/security/reports.json',
        'top.json',
      ]);

      const scoped = await adapter.list({ prefix: 'runtime/', limit: 100 });
      expect(scoped.objects).toHaveLength(2);
      expect(scoped.objects.every((o) => o.key.startsWith('runtime/'))).toBe(true);

      const single = await adapter.list({ limit: 1 });
      expect(single.objects).toHaveLength(1);
      expect(single.hasMore).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
