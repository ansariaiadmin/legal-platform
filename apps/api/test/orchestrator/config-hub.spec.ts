import { ConfigService } from '@nestjs/config';
import { ConfigHubService, BRAIN_CONFIG_KEY } from '../../src/modules/orchestrator/config-hub.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

function memStorage(): { provider: StorageProvider; store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  const provider: StorageProvider = {
    put: async ({ key, content }) => {
      store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content));
    },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  };
  return { provider, store };
}

const env = (vars: Record<string, string | undefined>) =>
  new ConfigService({ AI_LOCAL_BASE_URL: '', AI_BASE_URL: '', ...vars });

describe('config hub — owner connects a brain, no engineer (P1f)', () => {
  it('view() masks keys, reports env vs runtime source, honest lending description', async () => {
    const { provider } = memStorage();
    const hub = new ConfigHubService(env({ AI_LOCAL_BASE_URL: 'http://gpu:8080' }), provider);
    expect((await hub.view()).local.source).toBe('env');
    expect((await hub.view()).lendingScenario).toContain('محلی');
  });

  it('runtime override beats env AND raw key never re-enters the view', async () => {
    const { provider } = memStorage();
    const hub = new ConfigHubService(env({}), provider);
    await hub.setBrain({ target: 'cloud', apiKey: 'sk-abcdef123456SECRET', model: 'gpt-5-mini' }, 'owner');
    const view = await hub.view();
    expect(view.cloud.source).toBe('runtime');
    expect(view.cloud.apiKeyMasked).toBe('••••CRET');
    expect(JSON.stringify(view)).not.toContain('abcdef123456SECRET');
  });

  it('persists via StorageProvider — a FRESH hub instance sees the same brain', async () => {
    const { provider, store } = memStorage();
    await new ConfigHubService(env({}), provider).setBrain(
      { target: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'aya-persian' },
      'owner',
    );
    expect(store.has(BRAIN_CONFIG_KEY)).toBe(true);
    const rebooted = new ConfigHubService(env({}), provider);
    const local = await rebooted.effectiveLocal();
    expect(local?.model).toBe('aya-persian');
  });

  it('testConnection: honest ok=false without URL (never green theater)', async () => {
    const { provider } = memStorage();
    const hub = new ConfigHubService(env({}), provider);
    const r = await hub.testConnection({ target: 'local' });
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('presets re-route the router policy: senator = cloud-first', async () => {
    const { provider } = memStorage();
    const hub = new ConfigHubService(env({}), provider);
    await hub.setPreset('senator', 'owner');
    const view = await hub.view();
    expect(view.preset).toBe('senator');
    expect(view.effectivePolicy).toBe('hybrid_cloud_first');
    // and peek() is hot-sync — the router reads it without awaiting
    expect(hub.peek().preset).toBe('senator');
  });

  it('corrupted persisted config → boots clean on env (honest fallback)', async () => {
    const { provider, store } = memStorage();
    store.set(BRAIN_CONFIG_KEY, Buffer.from('{not json'));
    const hub = new ConfigHubService(env({ AI_LOCAL_BASE_URL: 'http://gpu:8080' }), provider);
    expect((await hub.view()).local.source).toBe('env');
  });
});
