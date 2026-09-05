import { BackupService, BACKUP_SCHEMA_VERSION } from '../../src/modules/ops/backup.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import { ERROR_CODES } from '@legal-platform/contracts';

function memStorage(): StorageProvider {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }) => {
      store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content));
      return { url: `mem://${key}`, key };
    },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (k) => void store.delete(k),
    list: async ({ prefix } = {}) => ({
      objects: [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((key) => ({ key, size: store.get(key)!.length, lastModified: new Date() })),
      hasMore: false,
    }),
    verifyConfig: async () => ({ valid: true }),
    getMetadata: () => ({ name: 'mem', driverType: 'local' as const }),
  };
}

describe('P7 — backup / restore', () => {
  it('roundtrip: everything stored comes back byte-identical', async () => {
    const storage = memStorage();
    await storage.put({ key: 'runtime/a.json', content: Buffer.from('{"x":1}') });
    await storage.put({ key: 'runtime/b.bin', content: Buffer.from([0, 1, 2, 255]) });

    const svc = new BackupService(storage);
    const bundle = await svc.createBundle();
    expect(bundle.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(bundle.keyCount).toBe(2);
    expect(bundle.scope).toContain('NOT included'); // honesty in writing

    // fresh empty destination
    const dest = memStorage();
    const destSvc = new BackupService(dest);
    const res = await destSvc.restore(bundle);
    expect(res.restored.sort()).toEqual(['runtime/a.json', 'runtime/b.bin']);
    expect(res.skipped).toEqual([]);
    expect((await dest.get('runtime/a.json')).toString()).toBe('{"x":1}');
    expect([...(await dest.get('runtime/b.bin'))]).toEqual([0, 1, 2, 255]);
  });

  it('wrong schema version is REJECTED, not partially applied', async () => {
    const svc = new BackupService(memStorage());
    await expect(svc.restore({ schemaVersion: 999, keys: {} })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_INVALID_INPUT,
    });
    await expect(svc.restore(null)).rejects.toBeTruthy();
  });

  it('corrupt entries are skipped and REPORTED per key — never half-written silently', async () => {
    const svc = new BackupService(memStorage());
    const res = await svc.restore({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      keys: {
        'runtime/good.json': Buffer.from('{"ok":true}').toString('base64'),
        'runtime/broken.json': Buffer.from('{not json').toString('base64'),
        'runtime/weird.json': 42 as unknown as string,
      },
    });
    expect(res.restored).toEqual(['runtime/good.json']);
    expect(res.skipped.map((s) => s.key).sort()).toEqual(['runtime/broken.json', 'runtime/weird.json']);
    expect(res.skipped.every((s) => s.reason.length > 0)).toBe(true);
  });
});

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalStorageAdapter } from '../../src/providers/storage/local-storage.adapter';

describe('P7 backup through the REAL local adapter (tmp dir on disk)', () => {
  it('roundtrips nested keys — the exact path the sandbox server takes', async () => {

    const dirA = mkdtempSync(join(tmpdir(), 'lp-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'lp-b-'));
    try {
      const src = new BackupService(new LocalStorageAdapter(new ConfigService({ LOCAL_STORAGE_PATH: dirA })));
      await src['storage'].put({ key: 'runtime/security/reports.json', content: Buffer.from('[{"x":1}]') });
      await src['storage'].put({ key: 'runtime/deployment-profile.json', content: Buffer.from('{"defaultLocale":"en"}') });

      const bundle = await src.createBundle();
      expect(bundle.keyCount).toBe(2); // the live-sandbox bug made this 0
      expect(Object.keys(bundle.keys)).toContain('runtime/security/reports.json');

      const dst = new BackupService(new LocalStorageAdapter(new ConfigService({ LOCAL_STORAGE_PATH: dirB })));
      const res = await dst.restore(bundle);
      expect(res.restored).toHaveLength(2);
      expect((await dst['storage'].get('runtime/deployment-profile.json')).toString()).toContain('"en"');
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
