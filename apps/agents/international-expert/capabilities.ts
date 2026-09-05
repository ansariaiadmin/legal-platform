import type { ISkill } from '@legal-platform/shared';
import { vocabularyScore } from '@legal-platform/shared';

/**
 * International-law expert genome (حقوق بین‌الملل) — P7-T6. THE first bilingual
 * skill genome in the fleet: Persian vocabulary AND English equivalents inside
 * every list, so a foreign operator's query routes identically to their
 * Iranian colleague's. Vocabulary only; matching stays the shared formula.
 */

const TREATIES = [
  'معاهده', 'کنوانسیون', 'کنوانسیون‌های', 'میثاق', 'پروتکل', 'مصوبه بین‌المللی',
  'treaty', 'treaties', 'convention', 'bilateral', 'multilateral', 'protocol', 'ratification', 'ratify',
];
const CROSS_BORDER = [
  'فرامرزی', 'قضاوت فرامرزی', 'حوزه قضایی', 'قانون حاکم', 'اجرای حکم خارجی',
  'cross-border', 'foreign judgment', 'jurisdiction', 'applicable law', 'governing law', 'enforcement abroad', 'forum shopping',
];
const IMMIGRATION = [
  'مهاجرت', 'اقامت', 'ویزا', 'تابعیت', 'تبعیت', 'پناهندگی', 'تبعه خارجی',
  'immigration', 'visa', 'residence permit', 'citizenship', 'asylum', 'refugee', 'nationality', 'work permit',
];
const TRADE_SANCTIONS = [
  'تحریم', 'اوفک', 'تجارت بین‌الملل', 'گمرک', 'قاچاق ارزی', 'صرافی بین‌المللی',
  'sanctions', 'ofac', 'international trade', 'customs', 'export control', 'arbitration', 'داوری بین‌المللی', 'icsid', 'uncitral',
];

export const skills: readonly ISkill[] = [
  { id: 'intl:treaties', description: 'Treaties & conventions / معاهدات و کنوانسیون‌ها', match: ({ query }) => vocabularyScore(TREATIES, query) },
  { id: 'intl:cross-border-civil', description: 'Cross-border disputes, jurisdiction & governing law / اختلافات فرامرزی', match: ({ query }) => vocabularyScore(CROSS_BORDER, query) },
  { id: 'intl:immigration', description: 'Immigration, visas, citizenship, asylum / مهاجرت، ویزا، تابعیت', match: ({ query }) => vocabularyScore(IMMIGRATION, query) },
  { id: 'intl:trade-sanctions', description: 'Sanctions, international trade & arbitration / تحریم و تجارت بین‌الملل', match: ({ query }) => vocabularyScore(TRADE_SANCTIONS, query) },
] as const;

export const AGENT_ID = 'international-expert';
export const AGENT_VERSION = '1.0.0';
