import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from '../../src/providers/storage/local-storage.adapter';
import { ConfigService } from '@nestjs/config';

/**
 * FIELD REVIEW 2026-09-05 #16: a crafted storage key must never escape the
 * storage root. join() collapses ../.. silently — we now hard-deny instead.
 */
describe('local storage — root confinement', () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lp-store-'));
    const config = { get: (k: string) => (k === 'LOCAL_STORAGE_PATH' ? root : undefined) } as ConfigService;
    adapter = new LocalStorageAdapter(config);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes and reads a normal key', async () => {
    await adapter.put({ key: 'runtime/x.json', content: Buffer.from('{"ok":1}') });
    const got = await adapter.get('runtime/x.json');
    expect(got.toString('utf8')).toBe('{"ok":1}');
  });

  it('HARD-DENIES a traversal key on write', async () => {
    await expect(
      adapter.put({ key: '../../etc/pwned.txt', content: Buffer.from('x') }),
    ).rejects.toMatchObject({ message: expect.stringContaining('escapes the storage root') });
  });

  it('HARD-DENIES a traversal key on read', async () => {
    await expect(adapter.get('../../package.json')).rejects.toMatchObject({
      message: expect.stringContaining('escapes the storage root'),
    });
  });

  it('HARD-DENIES delete too (no wiping ../files)', async () => {
    await expect(adapter.delete('../victim')).rejects.toMatchObject({
      message: expect.stringContaining('escapes the storage root'),
    });
  });

  it('encoded dot-dot that survives the sanitizer still dies here', async () => {
    await expect(adapter.put({ key: 'a/../../b', content: Buffer.from('x') })).rejects.toThrow();
  });
});
