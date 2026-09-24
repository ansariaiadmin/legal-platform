import type { ISkill } from '@legal-platform/shared';
import { vocabularyScore } from '@legal-platform/shared';

/**
 * Family expert genome (امور خانواده): divorce, custody, dowry, support.
 */

const DIVORCE = ['طلاق', 'طلاق توافقی', 'فسخ نکاح', 'جواز طلاق', 'divorce', 'annulment', 'dissolution'];
const CUSTODY = ['حضانت فرزند', 'حضانت', 'فرزند', 'ملاقات فرزند', 'سرپرستی فرزند', 'custody', 'visitation', 'guardianship'];
const DOWRY = ['مهریه', 'مهریه نقدی', 'اوراق مهریه', 'بذل مهریه', 'dowry', 'mahr'];
const SUPPORT = ['نفقه', 'اجرت‌المثل', 'نفقه فرزند', 'نفقه زوجه', 'آموزش فرزند', 'alimony', 'maintenance', 'child support'];

export const skills: readonly ISkill[] = [
  { id: 'fam:divorce', description: 'طلاق: توافقی، قضایی، فسخ نکاح', match: ({ query }) => vocabularyScore(DIVORCE, query) },
  { id: 'fam:custody', description: 'حضانت و ملاقات فرزند', match: ({ query }) => vocabularyScore(CUSTODY, query) },
  { id: 'fam:dowry', description: 'مهریه و حقوق مالی زوجه', match: ({ query }) => vocabularyScore(DOWRY, query) },
  { id: 'fam:support', description: 'نفقه، اجرت‌المثل، هزینه‌های فرزند', match: ({ query }) => vocabularyScore(SUPPORT, query) },
] as const;

export const AGENT_ID = 'family-expert';
export const AGENT_VERSION = '0.1.0';
