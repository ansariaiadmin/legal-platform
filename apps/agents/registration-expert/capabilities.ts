import type { ISkill } from '@legal-platform/shared';
import { vocabularyScore } from '@legal-platform/shared';

/**
 * Registration/documents expert genome (ثبتی/شهرت آفرین‌بان): deeds,
 * companies, notarized POAs, trademarks.
 */

const DEEDS = ['سند رسمی', 'دفتر اسناد رسمی', 'سند عادی', 'تنظیم سند', 'وکالت‌نامه رسمی', 'وکالت‌نامه محضری', 'مفاصاحساب', 'notary', 'deed', 'poa', 'power of attorney'];
const COMPANIES = ['ثبت شرکت', 'شرکت سهامی', 'شرکت با مسئولیت محدود', 'اساس‌نامه', 'ادغام', 'انحلال شرکت', 'تغییرات شرکت', 'rooznameh', 'company registration', 'articles of association', 'llc'];
const TRADEMARK = ['علامت تجاری', 'ثبت برند', 'شناسه ملی', 'اظهارنامه مالیاتی اشخاص حقوقی', 'trademark', 'brand registration', 'national id'];
const VITAL = ['شناسنامه', 'کارت ملی', 'سند ازدواج', 'سند طلاق', 'واقعات حیاتی', 'birth certificate', 'marriage certificate'];

export const skills: readonly ISkill[] = [
  { id: 'reg:deeds', description: 'اسناد رسمی، وکالت‌نامه محضری، دفتر اسناد', match: ({ query }) => vocabularyScore(DEEDS, query) },
  { id: 'reg:companies', description: 'ثبت شرکت‌ها، اساس‌نامه، ادغام و انحلال', match: ({ query }) => vocabularyScore(COMPANIES, query) },
  { id: 'reg:trademark', description: 'علامت تجاری و برند، شناسه ملی اشخاص حقوقی', match: ({ query }) => vocabularyScore(TRADEMARK, query) },
  { id: 'reg:vital', description: 'احوال شخصیه و اسناد هویتی', match: ({ query }) => vocabularyScore(VITAL, query) },
] as const;

export const AGENT_ID = 'registration-expert';
export const AGENT_VERSION = '0.1.0';
