import type { ISkill } from '@legal-platform/shared';
import { vocabularyScore } from '@legal-platform/shared';

/**
 * Criminal expert genome (امور کیفری): defense memos, procedure, sentencing.
 */

const DEFENSE = ['دفاع', 'وکالت کیفری', 'متهم', 'اتهام', 'برائت', 'defense', 'defence', 'accused', 'acquittal'];
const PROCEDURE = ['دادرسی کیفری', 'آیین دادرسی', 'دادسرا', 'بازپرس', 'قرار منعی تعقیب', 'جرم', 'تفهیم اتهام', 'criminal procedure', 'prosecutor', 'indictment'];
const SENTENCING = ['مجازات', 'حبس', 'جزای نقدی', 'تخفیف مجازات', 'آزادی مشروط', 'سابقه محکومیت', 'sentencing', 'prison', 'fine', 'parole'];
const CRIMES = ['سرقت', 'کلاهبرداری', 'ضرب و جرح', 'قتل', 'اسیدپاشی', 'تصادف منجر به فوت', 'جرایم رایانه‌ای', 'theft', 'fraud', 'assault', 'homicide'];

export const skills: readonly ISkill[] = [
  { id: 'crim:defense', description: 'دفاعیات و استراتژی دفاع کیفری', match: ({ query }) => vocabularyScore(DEFENSE, query) },
  { id: 'crim:procedure', description: 'آیین دادرسی کیفری: دادسرا، بازپرس، قرارها', match: ({ query }) => vocabularyScore(PROCEDURE, query) },
  { id: 'crim:sentencing', description: 'مجازات‌ها، تخفیف، آزادی مشروط', match: ({ query }) => vocabularyScore(SENTENCING, query) },
  { id: 'crim:crimes', description: 'انواع جرم و عناصر تشکیل‌دهنده آن‌ها', match: ({ query }) => vocabularyScore(CRIMES, query) },
] as const;

export const AGENT_ID = 'criminal-expert';
export const AGENT_VERSION = '0.1.0';
