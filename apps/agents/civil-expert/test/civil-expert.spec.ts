import { civilExpert } from '../src/civil-expert.agent';
import { AGENT_ID, skills } from '../capabilities';

describe('civil-expert (fleet member contract)', () => {
  it('identity matches capabilities.ts', () => {
    expect(civilExpert.agentId).toBe(AGENT_ID);
    expect(civilExpert.field).toBe('civil');
    expect(civilExpert.capabilities().map((s) => s.id)).toEqual(skills.map((s) => s.id));
  });

  it('routes a persian contract query to contracts skill', async () => {
    const r = await civilExpert.route({ query: 'فسخ قرارداد اجاره بعد از تخلف موجر' });
    expect(r?.skillId).toBe('civil:contracts');
    expect(r!.score).toBeGreaterThanOrEqual(0.4);
  });

  it('routes inheritance queries to inheritance skill', async () => {
    const r = await civilExpert.route({ query: 'تقسیم ارث و سهم‌الارث ورثه' });
    expect(r?.skillId).toBe('civil:inheritance');
  });

  it('flags output as ungrounded pending RAG (SPEC §9)', async () => {
    const r = await civilExpert.executeExpert({ taskId: 'x', query: 'سند ملک' });
    expect(r.ok).toBe(true);
    expect(r.meta?.grounded).toBe(false);
    expect(r.meta?.requiresReview).toBe(true);
    expect(r.citations).toBeUndefined();
    expect(r.output).toContain('کارشناس ارشد امور مدنی'); // persona signed
  });

  it('all skill ids unique and namespaced', () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('civil:')).toBe(true);
  });
});
