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

  it('real agent: provides contract analysis with citations (not mock)', async () => {
    const r = await civilExpert.executeExpert({ taskId: 'test-1', query: 'قرارداد اجاره آپارتمان با مبلغ ۱۰ میلیون و مدت یک سال' });
    expect(r.ok).toBe(true);
    expect(r.meta?.requiresReview).toBe(true);
    expect(r.output).toContain('کارشناس ارشد امور مدنی');
    // Real agent should provide analysis, not mock message
    expect(r.output).not.toContain('این پاسخ مولدنشده است');
    expect(r.output).toContain('تحلیل قرارداد');
    expect(r.citations).toBeDefined();
    expect(r.citations!.length).toBeGreaterThan(0);
    expect(r.meta?.grounded).toBe(true);
  });

  it('real agent: analyzes civil claim with steps', async () => {
    const r = await civilExpert.executeExpert({ taskId: 'test-2', query: 'مطالبه خسارت ناشی از عدم انجام تعهد قرارداد' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('خسارت');
    expect(r.citations!.length).toBeGreaterThan(0);
  });

  it('real agent: inheritance analysis', async () => {
    const r = await civilExpert.executeExpert({ taskId: 'test-3', query: 'تقسیم ارث بین ورثه و سهم زوجه' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('ارث');
    expect(r.output).toContain('طبقات ارث');
  });

  it('all skill ids unique and namespaced', () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('civil:')).toBe(true);
  });

  it('health check returns healthy', async () => {
    const health = await civilExpert.health();
    expect(health.healthy).toBe(true);
  });
});
