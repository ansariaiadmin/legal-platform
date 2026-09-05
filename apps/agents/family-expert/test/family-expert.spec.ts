import { familyExpert } from '../src/family-expert.agent';
import { AGENT_ID, skills } from '../capabilities';

describe('family-expert (fleet member contract)', () => {
  it('identity matches capabilities.ts', () => {
    expect(familyExpert.agentId).toBe(AGENT_ID);
    expect(familyExpert.field).toBe('family');
    expect(familyExpert.capabilities().map((s) => s.id)).toEqual(skills.map((s) => s.id));
  });

  it('routes custody question to custody skill', async () => {
    const r = await familyExpert.route({ query: 'حضانت فرزند دختر بعد از طلاق توافقی' });
    expect(r?.skillId).toBe('fam:custody');
  });

  it('routes dowry question to dowry skill', async () => {
    const r = await familyExpert.route({ query: 'استرداد اوراق مهریه نقدی' });
    expect(r?.skillId).toBe('fam:dowry');
  });

  it('flags output as ungrounded pending RAG (SPEC §9)', async () => {
    const r = await familyExpert.executeExpert({ taskId: 'x', query: 'نفقه زوجه' });
    expect(r.ok).toBe(true);
    expect(r.meta?.grounded).toBe(false);
    expect(r.citations).toBeUndefined();
  });

  it('all skill ids unique and namespaced', () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('fam:')).toBe(true);
  });
});
