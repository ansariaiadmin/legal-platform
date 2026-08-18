export const en = {
  'app.name': 'Legal Platform',
  'app.tagline': 'Practice Management for Lawyers',
};

export const fa = {
  'app.name': 'پلتفرم حقوقی',
  'app.tagline': 'مدیریت امور وکلا',
};

export type Locale = 'en' | 'fa';
export type TranslationKey = keyof typeof en;

export function t(key: TranslationKey, locale: Locale = 'en'): string {
  if (locale === 'fa') {
    return fa[key] || key;
  }
  return en[key] || key;
}
