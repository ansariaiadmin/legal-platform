import { ConfigService } from '@nestjs/config';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';
import { ModelAssignmentService } from '../../src/modules/orchestrator/model-assignment.service';

function build(env: Record<string, string>, localHealthy = true) {
  const assignments = new ModelAssignmentService();
  const router = new HybridInferenceRouter(new ConfigService(env), assignments);
  jest
    .spyOn(router as never as { probeLocal: () => Promise<boolean> }, 'probeLocal')
    .mockResolvedValue(localHealthy);
  return { assignments, router };
}

describe('Model assignment + Leader lending (ADR-011)', () => {
  it('manual local pin is honored with its concrete model id', async () => {
    const { assignments, router } = build({ AI_HYBRID_POLICY: 'hybrid_cloud_first' });
    assignments.assign('civil-expert', 'local', 'qwen2.5:14b', 'owner-1');
    const d = await router.decide({ agentId: 'civil-expert' });
    expect(d.target).toBe('local');
    expect(d.model).toBe('qwen2.5:14b');
    expect(d.assignmentSource).toBe('manual');
    expect(d.reason).toBe('manual_pin');
  });

  it('manual cloud pin beats the default local-first policy', async () => {
    const { assignments, router } = build({ AI_HYBRID_POLICY: 'hybrid_local_first' });
    assignments.assign('family-expert', 'cloud', 'gpt-4.1-mini', 'owner-1');
    const d = await router.decide({ agentId: 'family-expert' });
    expect(d.target).toBe('cloud');
    expect(d.model).toBe('gpt-4.1-mini');
    expect(d.assignmentSource).toBe('manual');
  });

  it('unassigned agent borrows the Leader (leader_fallback recorded)', async () => {
    const { router } = build({
      AI_HYBRID_POLICY: 'hybrid_local_first',
      AI_LOCAL_BASE_URL: 'http://gpu-box:8080', // local present ⇒ local lent
    });
    const d = await router.decide({ agentId: 'criminal-expert' });
    expect(d.assignmentSource).toBe('leader_fallback');
    expect(d.model).toBe('local-box-default');
  });

  it('SECRECY BEATS MANUAL PIN: privileged task on a cloud-pinned agent → local', async () => {
    const { assignments, router } = build({ AI_HYBRID_POLICY: 'hybrid_cloud_first' });
    assignments.assign('civil-expert', 'cloud', 'gpt-4.1-mini', 'owner-1');
    const d = await router.decide({ agentId: 'civil-expert', taskSensitivity: 'privileged' });
    expect(d.target).toBe('local');
    expect(d.reason).toBe('privileged_overrides_manual_pin');
  });

  it('unassign reverts the agent to Leader lending', async () => {
    const { assignments, router } = build({});
    assignments.assign('civil-expert', 'cloud', 'gpt-4.1-mini', 'owner-1');
    assignments.unassign('civil-expert');
    const d = await router.decide({ agentId: 'civil-expert' });
    expect(d.assignmentSource).toBe('leader_fallback');
  });

  it('degraded locals under a manual local pin stay local WITH the flag visible', async () => {
    const { assignments, router } = build(
      { AI_LOCAL_BASE_URL: 'http://gpu-box:8080' },
      false, // local unhealthy
    );
    assignments.assign('civil-expert', 'local', 'qwen2.5:7b', 'owner-1');
    const d = await router.decide({ agentId: 'civil-expert' });
    expect(d.target).toBe('local');
    expect(d.reason).toBe('manual_pin_local_degraded');
  });
});
