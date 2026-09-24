import { registrationExpert } from '../src/registration-expert.agent';
import { AGENT_ID, skills } from '../capabilities';

describe('registration-expert (fleet member contract)', () => {
  it('identity matches capabilities.ts', () => {
    expect(registrationExpert.agentId).toBe(AGENT_ID);
    expect(registrationExpert.field).toBe('registration');
    expect(registrationExpert.capabilities().map((s) => s.id)).toEqual(skills.map((s) => s.id));
  });

  it('routes company registration to companies skill', async () => {
    const r = await registrationExpert.route({ query: 'مراحل ثبت شرکت با مسئولیت محدود و اساس‌نامه' });
    expect(r?.skillId).toBe('reg:companies');
  });

  it('routes notarized POA to deeds skill', async () => {
    const r = await registrationExpert.route({ query: 'صدور وکالت‌نامه محضری در دفتر اسناد رسمی' });
    expect(r?.skillId).toBe('reg:deeds');
  });

  it('flags output as ungrounded pending RAG (SPEC §9)', async () => {
    const r = await registrationExpert.executeExpert({ taskId: 'x', query: 'علامت تجاری' });
    expect(r.ok).toBe(true);
    expect(r.meta?.grounded).toBe(false);
    expect(r.citations).toBeUndefined();
  });

  it('all skill ids unique and namespaced', () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('reg:')).toBe(true);
  });
});
