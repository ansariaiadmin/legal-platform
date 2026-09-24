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

  it('flags output as ungrounded pending RAG (SPEC §9)', async () => {
    const r = await criminalExpert.executeExpert({ taskId: 'x', query: 'مجازات حبس' });
    expect(r.ok).toBe(true);
    expect(r.meta?.grounded).toBe(false);
    expect(r.citations).toBeUndefined();
    expect(r.output).toContain('کارشناس ارشد امور کیفری');
  });

  it('all skill ids unique and namespaced', () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('crim:')).toBe(true);
  });
});
