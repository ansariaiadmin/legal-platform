import { SetupWizardService } from '../../src/modules/setup/setup.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

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
    list: async () => ({ objects: [...store.keys()].map((key) => ({ key, size: 0, lastModified: new Date() })), hasMore: false }),
    verifyConfig: async () => ({ valid: true }),
    getMetadata: () => ({ name: 'mem', driverType: 'local' as const }),
  };
}

describe('P8 setup wizard — the lawyer walks through, on any device, resumable', () => {
  it('full walk: idempotent start, ordered steps, defaults merged, finish', async () => {
    const svc = new SetupWizardService(memStorage());
    expect((await svc.status()).started).toBe(false);

    const s1 = await svc.start('owner-1');
    expect(s1.current).toBe('welcome');
    // second start resumes instead of clobbering
    const s1b = await svc.start('owner-1');
    expect(s1b.startedAt).toBe(s1.startedAt);

    await svc.advance('welcome', {}, 'owner-1');
    // profile requires payload — the wizard refuses silent skip
    await expect(svc.advance('profile', {}, 'owner-1')).rejects.toThrow(/requires a payload/);
    // out-of-order is refused too
    await expect(svc.advance('backup', {}, 'owner-1')).rejects.toThrow(/wizard is at 'profile'/);

    const s2 = await svc.advance('profile', { country: 'Germany', defaultLocale: 'en' }, 'owner-1');
    expect(s2.payloads.profile?.country).toBe('Germany');
    expect(s2.payloads.profile?.currency).toBe('IRT'); // default survives unoverridden
    expect(s2.current).toBe('brain');

    for (const step of ['brain', 'plans', 'library', 'backup', 'security'] as const) {
      const free = step === 'backup' || step === 'security';
      await svc.advance(step, free ? {} : { ok: true }, 'owner-1');
    }
    await svc.finish('owner-1');
    const fin = await svc.status();
    expect(fin.finished).toBe(true);
    expect(fin.completed).toContain('done');
  });

  it('state survives a restart (resume after coffee, on the other device)', async () => {
    const storage = memStorage();
    const a = new SetupWizardService(storage);
    await a.start('owner-1');
    await a.advance('welcome', {}, 'owner-1');
    await a.advance('profile', { defaultLocale: 'fa' }, 'owner-1');

    const b = new SetupWizardService(storage);
    const st = await b.status();
    expect(st.current).toBe('brain');
    expect(st.completed).toEqual(['welcome', 'profile']);

    await b.reset();
    expect((await b.status()).started).toBe(false);
  });
});
