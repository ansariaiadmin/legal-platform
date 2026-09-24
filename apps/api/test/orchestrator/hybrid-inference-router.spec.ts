import { ConfigService } from '@nestjs/config';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';
import { ModelAssignmentService } from '../../src/modules/orchestrator/model-assignment.service';
import { BudgetGateService } from '../../src/modules/orchestrator/budget-gate.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

function router(env: Record<string, string>, localHealthy = false, budget?: BudgetGateService) {
  const r = new HybridInferenceRouter(new ConfigService(env), new ModelAssignmentService(), undefined, budget);
  jest.spyOn(r as never as { probeLocal: () => Promise<boolean> }, 'probeLocal').mockResolvedValue(localHealthy);
  return r;
}

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

describe('HybridInferenceRouter (ADR-004)', () => {
  it('local_only pins everything to local', async () => {
    const d = await router({ AI_HYBRID_POLICY: 'local_only' }).decide({});
    expect(d.target).toBe('local');
    expect(d.reason).toBe('policy_pinned_local');
  });

  it('cloud_only pins everything to cloud', async () => {
    const d = await router({ AI_HYBRID_POLICY: 'cloud_only' }).decide({});
    expect(d.target).toBe('cloud');
    expect(d.reason).toBe('policy_pinned_cloud');
  });

  it('privileged tasks NEVER go to cloud, even when local is down', async () => {
    const d = await router({ AI_HYBRID_POLICY: 'hybrid_local_first' }, false).decide({
      taskSensitivity: 'privileged',
    });
    expect(d.target).toBe('local');
    expect(d.reason).toBe('privileged_data_local_degraded');
  });

  it('healthy local + local_first => local', async () => {
    const d = await router(
      { AI_HYBRID_POLICY: 'hybrid_local_first', AI_LOCAL_BASE_URL: 'http://gpu-box:8080' },
      true,
    ).decide({});
    expect(d.target).toBe('local');
    expect(d.reason).toBe('policy_local_first');
  });

  it('unhealthy local + headroom in budget => cloud fallback', async () => {
    const d = await router(
      { AI_HYBRID_POLICY: 'hybrid_local_first', AI_LOCAL_BASE_URL: 'http://gpu-box:8080', AI_MONTHLY_BUDGET_USD: '50' },
      false,
    ).decide({});
    expect(d.target).toBe('cloud');
    expect(d.reason).toBe('local_down');
  });

  it('exhausted budget on cloud_first demotes to local (cheap path)', async () => {
    const d = await router(
      { AI_HYBRID_POLICY: 'hybrid_cloud_first', AI_MONTHLY_BUDGET_USD: '0' },
      true,
    ).decide({});
    expect(d.target).toBe('local');
    expect(d.reason).toBe('budget_exhausted');
  });

  it('every decision carries its signals for the live dashboard', async () => {
    const d = await router({ AI_HYBRID_POLICY: 'local_only' }).decide({});
    expect(d.signals).toEqual({
      localHealthy: false,
      budgetRemainingUsd: null,
      taskSensitivity: 'normal',
    });
  });

  it('senator tier defaults cloud_first; others local_first', () => {
    expect(router({ AGENT_TIER: 'senator' }).currentPolicy()).toBe('hybrid_cloud_first');
    expect(router({ AGENT_TIER: 'counsel' }).currentPolicy()).toBe('hybrid_local_first');
    expect(router({}).currentPolicy()).toBe('hybrid_local_first');
  });

  it('FIELD REVIEW #15: monthly TOKEN budget is a real ledger — spend decrements remaining, exhaustion demotes cloud_first to local', async () => {
    const budget = new BudgetGateService(
      new ConfigService({ AI_FEATURE_QUOTA_TOKENS: '{}' }),
      memStorage(),
    );
    const r = router(
      { AI_HYBRID_POLICY: 'hybrid_cloud_first', AI_MONTHLY_TOKEN_BUDGET: '2000' },
      false,
      budget,
    );

    const first = await r.decide({});
    expect(first.target).toBe('cloud'); // untouched budget: cloud is allowed
    expect(first.signals.budgetRemainingUsd).toBe(2000);

    // platform actually spent 2100 tokens this month (e.g. tiebreak + draft calls)
    await budget.consume('tiebreak', { totalTokens: 2100 });

    const after = await r.decide({});
    expect(after.target).toBe('local'); // hard downgrade, not an alert nobody reads
    expect(after.reason).toBe('budget_exhausted');
    expect(after.signals.budgetRemainingUsd).toBe(0);
  });
});
