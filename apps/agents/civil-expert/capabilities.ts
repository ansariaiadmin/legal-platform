import type { ISkill } from '@legal-platform/shared';
import { vocabularyScore } from '@legal-platform/shared';

/**
 * Civil expert genome (امور مدنی). Vocabulary only — matching is the shared
 * deterministic formula from agent-kit, so the whole fleet routes identically.
 */

const CONTRACT = ['قرارداد', 'اجاره', 'خرید', 'فروش', 'بیع', 'معامله', 'عقد', 'فسخ', 'ابطال قرارداد', 'اجاره‌نامه', 'مبایعه‌نامه', 'contract', 'lease', 'sale', 'rescission'];
const PROPERTY = ['ملک', 'سند', 'مالکیت', 'زمین', 'آپارتمان', 'رهن', 'سرقفلی', 'انتقال', 'property', 'deed', 'mortgage', 'ownership'];
const TORT = ['خسارت', 'مسئولیت مدنی', 'تقصیر', 'ضرر', 'زیان', 'جبران خسارت', 'tort', 'liability', 'damages', 'negligence'];
const INHERITANCE = ['ارث', 'میراث', 'وصیت', 'ترکه', 'ورثه', 'سهم‌الارث', 'انحصار وراثت', 'inheritance', 'heir', 'will', 'probate'];

export const skills: readonly ISkill[] = [
  { id: 'civil:contracts', description: 'قراردادها: تنظیم، فسخ، ابطال، تعهدات', match: ({ query }) => vocabularyScore(CONTRACT, query) },
  { id: 'civil:property', description: 'املاك و اسناد مالكیت، رهن و سرقفلی', match: ({ query }) => vocabularyScore(PROPERTY, query) },
  { id: 'civil:tort', description: 'مسئولیت مدنی و جبران خسارت', match: ({ query }) => vocabularyScore(TORT, query) },
  { id: 'civil:inheritance', description: 'ارث، وصیت و انحصار وراثت', match: ({ query }) => vocabularyScore(INHERITANCE, query) },
] as const;

export const AGENT_ID = 'civil-expert';
export const AGENT_VERSION = '0.1.0';
