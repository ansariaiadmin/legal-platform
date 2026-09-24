import { LegalExpertBaseAgent } from '../src/legal-expert-base.agent';
import { AGENT_ID, skills } from '../capabilities';

describe('legal-expert-base', () => {
  const agent = new LegalExpertBaseAgent();

  it('advertises unique, well-formed skill ids', () => {
    const ids = agent.capabilities().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9:-]+$/);
  });

  it('exposes its capabilities config as the single source of skills', () => {
    expect(agent.capabilities().map((s) => s.id)).toEqual(skills.map((s) => s.id));
  });

  it('routes a civil query to the civil skill above threshold', async () => {
    const route = await agent.route({ query: 'سوال درباره فسخ قرارداد خرید ملک' });
    expect(route?.skillId).toBe('base:civil-qa');
    expect(route!.score).toBeGreaterThanOrEqual(0.4);
  });

  it('returns null when nothing clears the threshold', async () => {
    const route = await agent.route({ query: 'weather forecast tomorrow' });
    expect(route).toBeNull();
  });

  it('never fabricates legal text at phase 0 (SPEC §9)', async () => {
    const result = await agent.execute({ taskId: 't1', query: 'حضانت فرزند' });
    expect(result.ok).toBe(true);
    expect(result.meta?.grounded).toBe(false);
    expect(result.citations).toBeUndefined();
  });

  it('requires lawyer review for everything it says (SPEC §9)', () => {
    expect(agent.requiresReview).toBe(true);
  });

  it('is healthy and carries a stable identity', async () => {
    expect(agent.agentId).toBe(AGENT_ID);
    expect((await agent.health()).healthy).toBe(true);
  });
});
