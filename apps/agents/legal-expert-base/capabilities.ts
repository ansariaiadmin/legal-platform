import type { ISkill } from '@legal-platform/shared';

/**
 * The agent's "Skills" — the contract the orchestrator routes on (SPEC §11a).
 * Pure data + pure matching functions. No I/O, no SDKs, no singletons:
 * this file must be importable in tests, api and web without side effects.
 *
 * `match()` scores deterministically in [0,1] (ADR-003). Phase 1 experts
 * (civil/criminal/…) clone this shape and tighten their vocabularies.
 */

const CIVIL_TERMS = ['قانون مدنی', 'قرارداد', 'معامله', 'ملک', 'سند', 'civil', 'contract', 'property'];
const CRIMINAL_TERMS = ['کیفری', 'جرم', 'مجازات', 'دادسرا', 'criminal', 'penal'];
const FAMILY_TERMS = ['طلاق', 'حضانت', 'مهریه', 'ازدواج', 'family', 'divorce', 'custody'];

function score(terms: readonly string[], query: string): number {
  const q = query.toLowerCase();
  const hits = terms.filter((t) => q.includes(t.toLowerCase())).length;
  return hits === 0 ? 0 : Math.min(1, 0.3 + 0.2 * hits); // 1 hit=0.5, 2=0.7, 3+=0.9
}

export const skills: readonly ISkill[] = [
  {
    id: 'base:civil-qa',
    description: 'پاسخ به پرسش‌های مدنیِ پایه (قانون مدنی، قرارداد، املاک)',
    match: ({ query }) => score(CIVIL_TERMS, query),
  },
  {
    id: 'base:criminal-qa',
    description: 'پاسخ به پرسش‌های کیفریِ پایه (جرم، مجازات، دادرسی)',
    match: ({ query }) => score(CRIMINAL_TERMS, query),
  },
  {
    id: 'base:family-qa',
    description: 'پرسش‌های خانواده (طلاق، حضانت، مهریه)',
    match: ({ query }) => score(FAMILY_TERMS, query),
  },
] as const;

export const AGENT_ID = 'legal-expert-base';
export const AGENT_VERSION = '0.1.0';
