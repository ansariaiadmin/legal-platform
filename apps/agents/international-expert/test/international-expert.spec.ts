import { internationalExpert } from '../src/international-expert.agent';
import { AGENT_ID, skills } from '../capabilities';

describe('international-expert (P7 bilingual fleet member)', () => {
  it('identity matches capabilities.ts + bilingual persona present', () => {
    expect(internationalExpert.agentId).toBe(AGENT_ID);
    expect(internationalExpert.field).toBe('general');
    expect(internationalExpert.persona?.displayName).toContain('بین‌الملل');
    expect(internationalExpert.persona?.displayNameEn).toBe('Senior International-Law Counsel');
    expect(internationalExpert.persona?.mottoEn).toBeTruthy();
    expect(internationalExpert.capabilities().map((s) => s.id)).toEqual(skills.map((s) => s.id));
  });

  it('routes PERSIAN treaty queries', async () => {
    const r = await internationalExpert.route({ query: 'اجرای حکم خارجی و کنوانسیون تجاری بین ایران و آلمان' });
    expect(r).not.toBeNull();
    expect(['intl:treaties', 'intl:cross-border-civil']).toContain(r!.skillId);
  });

  it('routes ENGLISH queries identically — a foreign operator is a citizen here', async () => {
    const r = await internationalExpert.route({ query: 'enforcement of a foreign judgment in a cross-border commercial dispute, governing law?' });
    expect(r).not.toBeNull();
    expect(['intl:cross-border-civil', 'intl:treaties']).toContain(r!.skillId);
  });

  it('routes visa/asylum queries in BOTH languages', async () => {
    const fa = await internationalExpert.route({ query: 'درخواست پناهندگی و اقامت' });
    const en = await internationalExpert.route({ query: 'asylum application and residence permit' });
    expect(fa?.skillId).toBe('intl:immigration');
    expect(en?.skillId).toBe('intl:immigration');
  });

  it('declines pure family-law queries (family desk owns those)', async () => {
    const r = await internationalExpert.route({ query: 'طلاق توافقی و حضانت فرزند', }, 0.6);
    expect(r === null || (r.score < 1)).toBe(true);
  });

  it('all skill ids unique and intl:-namespaced', () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('intl:')).toBe(true);
  });

  it('agent-kit honesty: ungrounded marker + never impersonates final advice', async () => {
    const r = await internationalExpert.executeExpert({ taskId: 't', query: 'sanctions on trade' });
    expect(r.meta?.grounded).toBe(false);
    expect(r.meta?.requiresReview).toBe(true);
  });
});
