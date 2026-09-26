/**
 * Human-readable labels for expert skill ids. The API reports skills by id
 * (e.g. `civil:contracts`); the interface never shows raw ids.
 */
const SKILL_LABELS: Record<string, { fa: string; en: string }> = {
  'civil:contracts': { fa: 'قراردادها', en: 'Contracts' },
  'civil:property': { fa: 'املاک و اسناد مالکیت', en: 'Property and title deeds' },
  'civil:tort': { fa: 'مسئولیت مدنی', en: 'Civil liability' },
  'civil:inheritance': { fa: 'ارث و وصیت', en: 'Inheritance and wills' },
  'crim:defense': { fa: 'دفاع کیفری', en: 'Criminal defence' },
  'crim:procedure': { fa: 'آیین دادرسی کیفری', en: 'Criminal procedure' },
  'crim:sentencing': { fa: 'مجازات‌ها', en: 'Sentencing' },
  'crim:crimes': { fa: 'عناصر جرم', en: 'Elements of offences' },
  'fam:divorce': { fa: 'طلاق', en: 'Divorce' },
  'fam:custody': { fa: 'حضانت و ملاقات', en: 'Custody and visitation' },
  'fam:dowry': { fa: 'مهریه', en: 'Mahr (dower)' },
  'fam:support': { fa: 'نفقه و اجرت‌المثل', en: 'Maintenance' },
  'reg:deeds': { fa: 'اسناد رسمی', en: 'Official deeds' },
  'reg:companies': { fa: 'ثبت شرکت', en: 'Company registration' },
  'reg:trademark': { fa: 'علامت تجاری', en: 'Trademarks' },
  'reg:vital': { fa: 'احوال شخصیه', en: 'Civil status records' },
  'intl:treaties': { fa: 'معاهدات و کنوانسیون‌ها', en: 'Treaties and conventions' },
  'intl:cross-border-civil': { fa: 'اختلافات فرامرزی', en: 'Cross-border disputes' },
  'intl:immigration': { fa: 'مهاجرت و تابعیت', en: 'Immigration and nationality' },
  'intl:trade-sanctions': { fa: 'تجارت بین‌الملل و داوری', en: 'International trade and arbitration' },
};

export function skillLabel(id: string, locale: 'fa' | 'en'): string {
  const label = SKILL_LABELS[id];
  if (label) return label[locale];
  // Unknown (e.g. newly added) skill: show the readable tail of the id.
  const tail = id.includes(':') ? id.split(':').pop()! : id;
  return tail.replace(/[-_.]/g, ' ');
}
