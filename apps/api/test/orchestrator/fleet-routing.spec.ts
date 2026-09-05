import { ConfigService } from '@nestjs/config';
import { OrchestratorService } from '../../src/modules/orchestrator/orchestrator.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { IntentClassifier } from '../../src/modules/orchestrator/intent-classifier';
import { AgentGovernanceService } from '../../src/modules/orchestrator/agent-governance.service';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { civilExpert } from '@legal-platform/agent-civil-expert';
import { criminalExpert } from '@legal-platform/agent-criminal-expert';
import { familyExpert } from '@legal-platform/agent-family-expert';
import { registrationExpert } from '@legal-platform/agent-registration-expert';
import { ERROR_CODES } from '@legal-platform/contracts';

const FUTURE = new Date(Date.now() + 3600_000).toISOString();

function buildSociety() {
  const registry = new ExpertRegistry();
  // Same order as AgentsBootstrap: specialists first, general fallback last.
  for (const e of [civilExpert, criminalExpert, familyExpert, registrationExpert, new LegalExpertBaseAgent()]) {
    registry.register(e);
  }
  const governance = new AgentGovernanceService();
  const router = new HybridInferenceRouter(new ConfigService({ AI_LOCAL_BASE_URL: '', AI_MONTHLY_BUDGET_USD: '' }));
  const bus = new InProcessAgentEventBus();
  const service = new OrchestratorService(registry, governance, router, bus, new IntentClassifier());
  return { registry, governance, service };
}

async function grantAll(g: AgentGovernanceService) {
  for (const [agentId, capability] of [
    ['civil-expert', 'expert:civil:execute'],
    ['criminal-expert', 'expert:criminal:execute'],
    ['family-expert', 'expert:family:execute'],
    ['registration-expert', 'expert:registration:execute'],
  ] as const) {
    await g.grant({ agentId, capability, grantedBy: 'spec', expiresAt: FUTURE });
  }
}

describe('Fleet routing — the society at work (P1-T8)', () => {
  const cases: Array<{ query: string; agent: string; skill: string }> = [
    { query: 'فسخ قرارداد اجاره ملک بعد از تخلف مستأجر', agent: 'civil-expert', skill: 'civil:contracts' },
    { query: 'اعتراض به قرار منعی تعقیب دادسرا در پرونده کلاهبرداری', agent: 'criminal-expert', skill: 'crim:procedure' },
    { query: 'حضانت فرزند بعد از طلاق توافقی با کیست؟', agent: 'family-expert', skill: 'fam:custody' },
    { query: 'تنظیم وکالت‌نامه محضری در دفتر اسناد رسمی', agent: 'registration-expert', skill: 'reg:deeds' },
  ];

  for (const { query, agent, skill } of cases) {
    it(`routes «${query.slice(0, 24)}…» → ${agent}/${skill}`, async () => {
      const r = await buildSociety().service.route(query);
      expect(r.agentId).toBe(agent);
      expect(r.skillId).toBe(skill);
    });
  }

  it('each expert only executes under its OWN field grant', async () => {
    const { service, governance } = buildSociety();
    // Grant ONLY criminal — a civil query must still be denied on the
    // civil-expert, proving grants are per-field, not a global unlock.
    await governance.grant({
      agentId: 'criminal-expert',
      capability: 'expert:criminal:execute',
      grantedBy: 'spec',
      expiresAt: FUTURE,
    });
    const denied = await service.dispatch({ taskId: 'x', query: 'فسخ قرارداد اجاره' });
    expect(denied.result.ok).toBe(false);
    expect(denied.result.errorCode).toBe(ERROR_CODES.AI_AGENT_NOT_AUTHORIZED);

    const allowed = await service.dispatch({ taskId: 'y', query: 'قرار منعی تعقیب دادسرا' });
    expect(allowed.routing.agentId).toBe('criminal-expert');
    expect(allowed.result.ok).toBe(true);
  });

  it('granted dispatch returns persona, honestly ungrounded (SPEC §9)', async () => {
    const { service, governance } = buildSociety();
    await grantAll(governance);
    const { result } = await service.dispatch({ taskId: 'z', query: 'حضانت فرزند' });
    expect(result.ok).toBe(true);
    expect(result.meta?.grounded).toBe(false);
    expect(result.meta?.persona).toContain('خانواده');
  });

  it('a fully registered society reports a healthy multi-field fleet card set', async () => {
    const cards = await buildSociety().registry.describeFleet();
    const fields = cards.map((c) => c.field).sort();
    expect(fields).toEqual(['civil', 'criminal', 'family', 'general', 'registration']);
    expect(cards.every((c) => c.healthy && c.requiresReview)).toBe(true);
    expect(cards.find((c) => c.agentId === 'civil-expert')?.persona).toContain('مدنی');
  });
});
