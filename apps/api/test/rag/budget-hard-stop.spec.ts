import { ConfigService } from '@nestjs/config';
import { UsageMeterService } from '../../src/modules/rag/usage-meter.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

/**
 * FIELD REVIEW 2026-09-05 #15: the AI budget must be a BOUNDARY, not a
 * broadcast. Spec: priced spend at/over AI_MONTHLY_HARD_STOP_USD ⇒ drafting
 * refuses with AI_BUDGET_HARD_STOPPED; under ⇒ normal work.
 */
function memStorage(): StorageProvider {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }: { key: string; content: Buffer }) => { store.set(key, Buffer.from(content)); },
    get: async (key: string) => {
      const v = store.get(key);
      if (!v) throw new Error('not found');
      return v;
    },
    delete: async (key: string) => { store.delete(key); },
    list: async () => [],
  } as unknown as StorageProvider;
}

function meter(env: Record<string, string>): UsageMeterService {
  return new UsageMeterService(memStorage(), new ConfigService(env));
}

describe('usage meter — monthly hard stop', () => {
  it('alerts do not stop; the CAP stops', async () => {
    // pricing: 0.001 USD per 1k tokens for model m → 1M tokens = 1 USD
    const m = meter({ AI_MONTHLY_HARD_STOP_USD: '1', AI_TOKEN_PRICING_USD: '{"m":0.001}' });
    expect(await m.hardStopExceeded()).toBe(false);
    await m.recordCall({ feature: 'drafting', model: 'm', usage: { totalTokens: 500_000 } }); // 0.5 USD
    expect(await m.hardStopExceeded()).toBe(false);
    await m.recordCall({ feature: 'drafting', model: 'm', usage: { totalTokens: 600_000 } }); // 1.1 total
    expect(await m.hardStopExceeded()).toBe(true);
  });

  it('no cap configured ⇒ never stops (opt-in boundary)', async () => {
    const m = meter({ AI_TOKEN_PRICING_USD: '{"m":1}' });
    await m.recordCall({ feature: 'drafting', model: 'm', usage: { totalTokens: 9_000_000 } });
    expect(await m.hardStopExceeded()).toBe(false);
  });

  it('unpriced spend cannot trip the stop (honest accounting: unknown cost is not capped)', async () => {
    const m = meter({ AI_MONTHLY_HARD_STOP_USD: '0.0000001' }); // absurdly low, but model unknown
    await m.recordCall({ feature: 'drafting', model: 'unknown', usage: { totalTokens: 10_000_000 } });
    expect(await m.hardStopExceeded()).toBe(false); // cost null ⇒ not counted
  });
});
