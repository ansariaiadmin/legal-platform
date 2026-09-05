import { ConfigService } from '@nestjs/config';
import { OrchestratorService } from '../../src/modules/orchestrator/orchestrator.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { IntentClassifier } from '../../src/modules/orchestrator/intent-classifier';
import { AgentGovernanceService } from '../../src/modules/orchestrator/agent-governance.service';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { ERROR_CODES } from '@legal-platform/contracts';
import type { AgentEvent } from '@legal-platform/shared';

const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();

function build() {
  const registry = new ExpertRegistry();
  registry.register(new LegalExpertBaseAgent());
  const governance = new AgentGovernanceService();
  const config = new ConfigService({ AI_LOCAL_BASE_URL: '', AI_MONTHLY_BUDGET_USD: '' });
  const router = new HybridInferenceRouter(config);
  const bus = new InProcessAgentEventBus();
  const service = new OrchestratorService(registry, governance, router, bus, new IntentClassifier());
  return { registry, governance, router, bus, service };
}

async function grantExecute(governance: AgentGovernanceService, agentId: string) {
  await governance.grant({
    agentId,
    capability: 'expert:civil:execute',
    grantedBy: 'owner-1',
    expiresAt: FUTURE,
  });
}

describe('OrchestratorService — gated dispatch (ADR-004/005/006)', () => {
  it('routes a civil query to the base expert and its civil skill', async () => {
    const r = await build().service.route('سوال درباره فسخ قرارداد خرید ملک');
    expect(r.agentId).toBe('legal-expert-base');
    expect(r.skillId).toBe('base:civil-qa');
  });

  it('DENIED: dispatch without a grant stops at the governance gate', async () => {
    const { service } = build();
    const { result } = await service.dispatch({ taskId: 't-1', query: 'فسخ قرارداد ملک' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.AI_AGENT_NOT_AUTHORIZED);
    expect(result.meta?.governanceReason).toBe('no_grant');
  });

  it('flows end to end once the Leader issues a grant', async () => {
    const { service, governance } = build();
    await grantExecute(governance, 'legal-expert-base');
    const { routing, result, inference } = await service.dispatch({
      taskId: 't-2',
      query: 'فسخ قرارداد ملک',
    });
    expect(routing.agentId).toBe('legal-expert-base');
    expect(result.ok).toBe(true);
    expect(result.meta?.grantId).toBeDefined();
    expect(inference).not.toBeNull();
  });

  it('DENIED again the moment the grant is revoked', async () => {
    const { service, governance } = build();
    const grant = await governance.grant({
      agentId: 'legal-expert-base',
      capability: 'expert:civil:execute',
      grantedBy: 'owner-1',
      expiresAt: FUTURE,
    });
    await governance.revoke(grant.grantId, 'owner-1');
    const { result } = await service.dispatch({ taskId: 't-3', query: 'فسخ قرارداد ملک' });
    expect(result.ok).toBe(false);
    expect(result.meta?.governanceReason).toBe('revoked');
  });

  it('disabled agents are invisible to routing (manual dashboard off-switch)', async () => {
    const { service, governance } = build();
    governance.setDisabled('legal-expert-base', true);
    await grantExecute(governance, 'legal-expert-base');
    const r = await service.route('فسخ قرارداد ملک');
    expect(r.agentId).toBeNull();
  });

  it('emits the full live event trail for one dispatch', async () => {
    const { service, governance, bus } = build();
    const seen: AgentEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    await grantExecute(governance, 'legal-expert-base');
    await service.dispatch({ taskId: 't-4', query: 'فسخ قرارداد ملک' });
    expect(seen.map((e) => e.kind)).toEqual([
      'task.accepted',
      'task.classified',
      'task.routed',
      'inference.decided',
      'skill.started',
      'task.completed',
    ]);
    expect(seen.every((e) => e.taskId === 't-4' || e.taskId === 'route-only')).toBe(true);
  });
});
