import { criminalExpert } from '../src/criminal-expert.agent';
import { AGENT_ID, skills } from '../capabilities';

describe('criminal-expert (fleet member contract)', () => {
  it('identity matches capabilities.ts', () => {
    expect(criminalExpert.agentId).toBe(AGENT_ID);
    expect(criminalExpert.field).toBe('criminal');
    expect(criminalExpert.capabilities().map((s) => s.id)).toEqual(skills.map((s) => s.id));
  });

  it('routes a prosecutor/procedure query to procedure skill', async () => {
    const r = await criminalExpert.route({ query: 'قرار منعی تعقیب دادسرا و اعتراض به آن' });
    expect(r?.skillId).toBe('crim:procedure');
  });

  it('routes theft accusation to crimes skill or defense', async () => {
    const r = await criminalExpert.route({ query: 'اتهام سرقت و کلاهبرداری موکل' });
    expect(['crim:crimes', 'crim:defense']).toContain(r?.skillId);
  });

  it('real agent: provides crime analysis with punishment (not mock)', async () => {
    const r = await criminalExpert.executeExpert({ taskId: 'test-1', query: 'اتهام سرقت و مجازات آن چیست' });
    expect(r.ok).toBe(true);
    expect(r.meta?.requiresReview).toBe(true);
    expect(r.output).toContain('کارشناس ارشد امور کیفری');
    // Real agent should provide analysis, not mock
    expect(r.output).not.toContain('این پاسخ مولدنشده است');
    expect(r.output).toContain('تحلیل کیفری');
    expect(r.output).toContain('سرقت');
    expect(r.citations).toBeDefined();
    expect(r.citations!.length).toBeGreaterThan(0);
    expect(r.meta?.grounded).toBe(true);
  });

  it('real agent: analyzes fraud with defenses', async () => {
    const r = await criminalExpert.executeExpert({ taskId: 'test-2', query: 'کلاهبرداری و دفاعیات آن' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('کلاهبرداری');
    expect(r.output).toContain('دفاعیات');
    expect(r.citations!.length).toBeGreaterThan(0);
  });

  it('real agent: procedure analysis', async () => {
    const r = await criminalExpert.executeExpert({ taskId: 'test-3', query: 'مراحل دادرسی کیفری و قرارهای تامین' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('دادرسی کیفری');
    expect(r.output).toContain('قرارهای تامین');
  });

  it('real agent: sentencing and mitigation', async () => {
    const r = await criminalExpert.executeExpert({ taskId: 'test-4', query: 'تخفیف مجازات و تعلیق اجرای مجازات' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('مجازات');
    expect(r.output).toContain('تخفیف');
  });

  it('all skill ids unique and namespaced', () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('crim:')).toBe(true);
  });

  it('health check returns healthy', async () => {
    const health = await criminalExpert.health();
    expect(health.healthy).toBe(true);
  });
});
