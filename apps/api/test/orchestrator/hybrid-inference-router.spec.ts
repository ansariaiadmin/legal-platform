import { ConfigService } from '@nestjs/config';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';

function router(env: Record<string, string>, localHealthy = false) {
  const r = new HybridInferenceRouter(new ConfigService(env));
  jest.spyOn(r as never as { probeLocal: () => Promise<boolean> }, 'probeLocal').mockResolvedValue(localHealthy);
  return r;
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
});
