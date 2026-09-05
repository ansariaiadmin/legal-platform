export const en = {
  'app.name': 'Legal Platform',
  'app.tagline': 'Practice Management for Lawyers',
};

export const fa = {
  'app.name': 'پلتفرم حقوقی',
  'app.tagline': 'مدیریت امور وکلا',

  // tabs
  'tab.home': 'خانه',
  'tab.brain': 'اتصال مغز',
  'tab.fleet': 'ناوگان',
  'tab.chat': 'چت با لیدر',
  'tab.files': 'فایل‌ها',
  'tab.kitchen': 'آشپزخانه زنده',
  'tab.telecoms': 'مخابرات مشاوره',
  'tab.library': 'کتابخانه',

  // home
  'home.title': 'دفتر حقوقی تو، با یک جامعه‌ای از کارشناس‌ها',
  'home.lending': 'وضعیت قرضِ مغز لیدر',
  'home.preset': 'تیر فعال',
  'home.policy': 'سیاست استنتاج',

  // brain
  'brain.local': 'مغز محلی',
  'brain.local.hint': 'هیچ دیتایی دفتر را ترک نمی‌کند — انتخاب امن',
  'brain.cloud': 'مغز ابری',
  'brain.cloud.hint': 'قوی و سریع؛ دیتای محرمانه هرگز به اینجا نمی‌رود',
  'brain.baseUrl': 'آدرس مدل',
  'brain.model': 'نام مدل',
  'brain.apiKey': 'کلید API',
  'brain.test': 'تست اتصال',
  'brain.save': 'ذخیره و اتصال',
  'brain.source.runtime': 'تنظیم زنده از داشبورد',
  'brain.source.env': 'از فایل محیطی',
  'brain.source.none': 'وصل نشده',
  'brain.tier.spartan': 'اسپارتان',
  'brain.tier.spartan.hint': 'اقتصادی و لوکال‌محور',
  'brain.tier.counsel': 'کانسل',
  'brain.tier.counsel.hint': 'تعادل کیفیت/هزینه — پیشنهاد ما',
  'brain.tier.senator': 'سناتور',
  'brain.tier.senator.hint': 'حداکثر کیفیت، ابر اول',
  'brain.ask_leader': 'یا به‌جای فرم، به لیدر بگو: «به مدل محلی وصل شو…»',

  // fleet
  'fleet.healthy': 'سالم',
  'fleet.disabled': 'غیرفعال',
  'fleet.grants': 'گرنت فعال',
  'fleet.lends': 'لیدر مغز قرض می‌دهد',

  // chat
  'chat.placeholder': 'با لیدر حرف بزن… (مثلاً: «به مدل محلی وصل شو آدرس http://…»)',
  'chat.send': 'بفرست',
  'chat.attach': 'پیوست',
  'chat.confirm': 'بله، انجام بده',
  'chat.you': 'شما',
  'chat.leader': 'لیدر',
  'chat.grounded': 'مبتنی بر متن فایل',

  // files
  'files.drop': 'هر فایلی را اینجا بینداز',
  'files.analyzing': 'لیدر دارد می‌خواندش…',
  'files.placement': 'پیشنهاد جایگذاری',

  // kitchen
  'kitchen.title': 'آشپزخانه زنده',
  'kitchen.subtitle': 'سکوی کار ایجنت‌ها — می‌بینی کی دارد چه می‌پزد',
  'kitchen.waiting': 'در انتظار رویداد… با لیدر حرف بزن تا اینجا زنده شود',
  'kitchen.event': 'رویداد',

  // auth
  'auth.title': 'ورود به دفتر',
  'auth.phone': 'شماره موبایل',
  'auth.otp': 'کد تأیید',
  'auth.sendOtp': 'ارسال کد',
  'auth.verify': 'ورود',
  'auth.devToken': 'توکن توسعه (فقط سندباکس)',
  'auth.devLogin': 'ورود توسعه',
};

export type Locale = 'en' | 'fa';
export type TranslationKey = keyof typeof fa;

export function t(key: TranslationKey, locale: Locale = 'fa'): string {
  if (locale === 'fa') {
    return (fa as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  }
  return (en as Record<string, string>)[key] ?? (fa as Record<string, string>)[key] ?? key;
}
