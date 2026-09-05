import { OrchestratorService } from '../../src/modules/orchestrator/orchestrator.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { IntentClassifier } from '../../src/modules/orchestrator/intent-classifier';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { ERROR_CODES } from '@legal-platform/contracts';

function buildService() {
  const registry = new ExpertRegistry();
  registry.register(new LegalExpertBaseAgent());
  return new OrchestratorService(registry, new IntentClassifier());
}

describe('OrchestratorService — The Leader (SPEC §11a pillar 3)', () => {
  it('routes a civil query to the base expert and its civil skill', async () => {
    const r = await buildService().route('سوال درباره فسخ قرارداد خرید ملک');
    expect(r.agentId).toBe('legal-expert-base');
    expect(r.skillId).toBe('base:civil-qa');
    expect(r.score).toBeGreaterThan(0);
    expect(r.classification.field).toBe('civil');
  });

  it('dispatches end to end and reports ungrounded output honestly', async () => {
    const { routing, result } = await buildService().dispatch({
      taskId: 't-1',
      query: 'شرایط حضانت فرزند چیست؟',
    });
    expect(routing.agentId).toBe('legal-expert-base');
    expect(result.ok).toBe(true);
    expect(result.meta?.grounded).toBe(false);
  });

  it('returns AI_NO_EXPERT_MATCHED (contracts) when nothing can route', async () => {
    const { result } = await buildService().dispatch({
      taskId: 't-2',
      query: 'unrelated topic with no legal vocabulary at all',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.AI_NO_EXPERT_MATCHED);
  });

  it('skips unhealthy experts instead of crashing (SPEC §2 failure domains)', async () => {
    const registry = new ExpertRegistry();
    const sick = new LegalExpertBaseAgent();
    jest.spyOn(sick, 'health').mockResolvedValue({ healthy: false, detail: 'simulated' });
    registry.register(sick);
    const service = new OrchestratorService(registry, new IntentClassifier());

    const r = await service.route('سوال درباره فسخ قرارداد');
    expect(r.agentId).toBeNull();
  });

  it('rejects duplicate expert registration at wiring time', () => {
    const registry = new ExpertRegistry();
    registry.register(new LegalExpertBaseAgent());
    expect(() => registry.register(new LegalExpertBaseAgent())).toThrow(/duplicate/);
  });

  it('describes the tree grouped by field', () => {
    const tree = buildService().getTree();
    expect(tree).toEqual([{ field: 'general', agents: ['legal-expert-base'] }]);
  });
});
