/**
 * P7 i18n/UI-prefs engine — the single source of truth for language,
 * direction, and theme. Deliberately framework-light: a tiny module-local
 * store + a window event, so ANY component re-renders on change (no context
 * provider acrobats, no third-party dep).
 *
 * Rules (ADR-022):
 * - keys are kebab-dot names; UI code never holds literals;
 * - every fa key must have an en twin — `npm run typecheck` enforces shape,
 *   and apps/web typecheck keys are pinned by the keyof typeof fa type;
 * - locale & theme persist in localStorage; server profile
 *   (`/dashboard/config/profile.defaultLocale`) is the org-level default the
 *   dashboard adopts on first visit, afterwards the USER's choice wins.
 */

export const en = {
  'app.name': 'Legal Platform',
  'app.tagline': 'Practice management for lawyers',
  'app.tagline.short': 'Smart office practice suite',

  // tabs
  'tab.home': 'Home',
  'tab.brain': 'Connect Brain',
  'tab.fleet': 'Fleet',
  'tab.chat': 'Leader Chat',
  'tab.files': 'Files',
  'tab.kitchen': 'Live Kitchen',
  'tab.telecoms': 'Consult Telecoms',
  'tab.library': 'Library',
  'tab.drafts': 'Drafts',
  'tab.security': 'Security',
  'nav.more': 'More',

  // chrome
  'chrome.logout': 'Sign out',
  'chrome.lang': 'فارسی',
  'chrome.theme.dark': 'Night',
  'chrome.theme.light': 'Day',
  'chrome.tour': 'Guide',

  // onboarding tour
  'tour.next': 'Next',
  'tour.prev': 'Back',
  'tour.skip': 'Skip tour',
  'tour.done': 'Got it!',
  'tour.stepIndicator': 'Step',
  'tour.of': 'of',
  'tour.welcome.title': 'Welcome to your smart office',
  'tour.welcome.body': 'This short tour walks through every desk. You can restart it anytime from the 💡 button. Everything is bilingual.',
  'tour.home.title': 'Home — today at a glance',
  'tour.home.body': 'Wallet balance, waiting queue and brain state live here. It is read-only: nothing can break from this tab.',
  'tour.brain.title': 'Connect Brain — give the office a mind',
  'tour.brain.body': 'Paste a local model URL (fully private) or a cloud API key. Secrets travel only to your own deployment — never to us.',
  'tour.brain.try': 'Fill a sample local brain',
  'tour.fleet.title': 'Fleet — who works for you',
  'tour.fleet.body': 'Each expert agent has skills and a persona. The international desk answers in both Persian and English.',
  'tour.chat.title': 'Leader chat — talk your office into shape',
  'tour.chat.body': 'Tell the Leader things like “set platform to English” or “برای آلمان کانفیگ کن”. Config changes are proposed, then YOU confirm.',
  'tour.files.title': 'Files — analyze first, judge later',
  'tour.files.body': 'Upload any file; the analyzer says what it is and whether it needs OCR before anything is claimed.',
  'tour.kitchen.title': 'Live kitchen — watch the agents cook',
  'tour.kitchen.body': 'Every routing decision, model choice and event streams here live. Nothing happens in a black box.',
  'tour.telecoms.title': 'Consult telecoms — the phone desk',
  'tour.telecoms.body': 'Open/close the queue, sell 10/20/30-minute plans, notify the next client automatically.',
  'tour.library.title': 'Library — the books are the law',
  'tour.library.body': 'Paste a law text or shelf an uploaded file. Only VERIFIED corpus grounds an answer — grounding is the entry fee.',
  'tour.library.try': 'Paste the sample article',
  'tour.drafts.title': 'Drafts — citations or nothing',
  'tour.drafts.body': 'Drafts are born from library sources only, carry provenance, and wait for YOUR review. No review, no delivery.',
  'tour.drafts.try': 'Fill a sample draft prompt',
  'tour.security.title': 'Security — the guardian watches always',
  'tour.security.body': 'The guardian scores the platform 0–10 against OWASP/ASVS/NIST daily and reports regressions to the Leader.',
  'tour.security.try': 'Run a scan now',

  // security tab
  'security.title': 'Security — guardian & standards compliance',
  'security.posture': 'Security posture score',
  'security.lastScan': 'Last audit',
  'security.neverScanned': 'Not audited yet — the guardian runs daily',
  'security.standardsVersion': 'Standards bundle version',
  'security.rescan': 'Run audit now',
  'security.regressed': 'Regressed since last report',
  'security.improved': 'Improved since last report',
  'security.check': 'Check',
  'security.refs': 'Standard refs',
  'security.status': 'Status',
  'security.evidence': 'Evidence / fix',
  'security.notScannedYet': '— awaiting the first scan',

  // library
  'library.fake.title': 'Knowledge library',
  'library.search.cta': 'Search',
  'library.ingest.paste': 'Paste law text',
  'library.ingest.file': 'Shelf from uploaded files',
  'library.verify': 'Verify (mark legal review passed)',

  // drafts
  'drafts.title': 'Drafts',
  'drafts.usage': 'This month so far',
  'drafts.create': 'Ask for a draft',
  'drafts.review.approve': 'Approve',
  'drafts.review.reject': 'Reject',
  'drafts.supersede': 'Supersede',
  'drafts.sources': 'Sources',

  // machines
  'machines.title': 'Machine tokens',
  'machines.issue': 'Issue token',
  'machines.revoke': 'Revoke',

  // kitchen
  'kitchen.title': 'Live kitchen',
  'kitchen.subtitle': 'The agents’ work deck — watch who cooks what',
  'kitchen.waiting': 'Waiting for events… talk to the Leader to bring this alive',
  'kitchen.event': 'Event',

  // auth
  'auth.title': 'Enter the office',
  'auth.phone': 'Mobile number',
  'auth.otp': 'Verification code',
  'auth.sendOtp': 'Send code',
  'auth.verify': 'Sign in',
  'auth.devToken': 'Dev token (sandbox only)',
  'auth.channel.phone': 'Mobile',
  'auth.channel.email': 'Email',
  'auth.email': 'Email address',
  'auth.sendEmailOtp': 'Email me the code',
  'auth.devLogin': 'Dev sign-in',

  // ops / backup
  'ops.backup': 'Backup',
  'ops.backup.download': 'Download backup bundle',
  'ops.backup.restore': 'Restore from bundle',
  'ops.backup.scopeNote': 'Covers runtime keys only — SQL tables need a pg_dump alongside.',

  // samples used by tour "try" buttons
  'sample.law': 'ماده ۱۰ قانون مدنی — قراردادهای خصوصی، در صورتی که مخالف صریح قانون نباشند، نسبت به طرفین لازم‌الاجراست.',
  'sample.draftPrompt': 'نظر کارشناسی درباره فسخ قرارداد اجاره به علت عدم پرداخت اجاره سه ماه متوالی',

    // P8 — setup wizard + vault
  'wizard.title': 'Office setup wizard',
  'wizard.advance': 'Done — next',
  'wizard.later': 'Continue later',
  'wizard.finish': 'All set — to the office',
  'wizard.resumeHint': 'Resumes from right here, any device',
  'wizard.profile.country': 'Country (e.g. Iran / Germany)',
  'wizard.step.welcome.title': 'Welcome — 5 minutes to a full office',
  'wizard.step.welcome.body': 'A few short steps: intro, brain hookup, consult plans, corpus, backup, security. Each step opens its tab.',
  'wizard.step.profile.title': 'Office profile & language',
  'wizard.step.profile.body': 'Set default country and language — the UI flips RTL/LTR and bilingual instantly; re-doable for any country.',
  'wizard.step.brain.title': 'Connect the brain',
  'wizard.step.brain.body': 'Paste a local model URL or a cloud API key in the Connect Brain tab; preset Counsel is hybrid.',
  'wizard.step.plans.title': 'Phone consult plans',
  'wizard.step.plans.body': '10/20/30-minute durations and pricing in the telecoms tab. Defaults are ready.',
  'wizard.step.library.title': 'First library shelf',
  'wizard.step.library.body': 'Shelf at least one law text — answers cite only verified sources.',
  'wizard.step.backup.title': 'First backup',
  'wizard.step.backup.body': 'Download the runtime backup bundle from the security tab and store it safely.',
  'wizard.step.security.title': 'Area locks & passkeys',
  'wizard.step.security.body': 'Set area passwords for config/vault/ops, register a passkey (fingerprint/face), meet the rotation bot.',
  'wizard.step.done.title': 'All ready 🎉',
  'wizard.step.done.body': 'Setup complete — your office is daily-driver ready; the Leader and tour are one tap away.',

  'vault.title': 'Panel password & security bot',
  'vault.msg.lockSet': 'Area lock enabled.',
  'vault.msg.fail': 'Failed — length/policy requirements not met.',
  'vault.msg.unlocked': 'Admission ticket issued (12h).',
  'vault.msg.wrongPw': 'Wrong password, or the IP is temporarily locked.',
  'vault.msg.passkeyAdded': 'Passkey registered (fingerprint/face ready).',
  'vault.msg.rotated': 'Rotation complete; the credentials file downloaded.',
  'vault.rotation.title': 'Credential rotation robot',
  'vault.rotation.never': 'never rotated',
  'vault.rotation.rotateAll': 'Rotate ALL credentials — one button',
  'vault.rotation.note': 'Server env secrets (JWT/encryption) rotate in your env file — the API never touches them (honesty).',
  'vault.locks.title': 'Area locks (second-factor gates)',
  'vault.locks.unlockPh': 'Area password…',
  'vault.locks.newPw': 'New password (≥8 chars)…',
  'vault.locks.unlock': 'Unlock',
  'vault.locks.disable': 'Remove lock',
  'vault.locks.set': 'Set lock',
  'vault.locks.ticketAlive': 'ticket active',
  'vault.passkey.title': 'Passkeys (fingerprint / face)',
  'vault.passkey.hint': 'WebAuthn; one-shot challenge, device signature, the secret never leaves the device.',
  'vault.passkey.unsupported': 'This browser lacks getPublicKey() — try a current Chrome/Safari.',
  'vault.passkey.cancelled': 'Operation cancelled or timed out.',
  'vault.passkey.none': 'No passkeys registered yet.',
  'vault.passkey.add': 'Register fingerprint/face',
  'vault.passkey.uses': 'uses:',

  // legacy keys carried over (P7 — never silently drop a UI string)
  'drafts.review.supersede': 'Supersede (spawn successor)',
  'home.title': 'Today',
  'home.lending': 'Lending',
  'home.preset': 'Preset',
  'home.policy': 'Policy',
  'home.greeting.morning': 'Good morning, counselor',
  'home.greeting.afternoon': 'Good afternoon, counselor',
  'home.greeting.evening': 'Good evening, counselor',
  'home.system.details': 'System status — one honest readout',
  'home.kpi.brain': 'Leader brain',
  'home.kpi.brain.on': 'connected',
  'home.kpi.brain.off': 'not connected',
  'home.kpi.deployment': 'Deployment',
  'home.kpi.theme': 'theme vocabulary',
  'brain.local': 'Local box',
  'brain.local.hint': 'On-premise / self-hosted model',
  'brain.cloud': 'Cloud',
  'brain.cloud.hint': 'External gateway (usage is billed to you)',
  'brain.baseUrl': 'Base URL',
  'brain.model': 'Model',
  'brain.apiKey': 'API key',
  'brain.test': 'Test connection',
  'brain.save': 'Save',
  'brain.source.runtime': 'dashboard override',
  'brain.source.env': 'from env',
  'brain.source.none': 'not configured',
  'brain.tier.spartan': 'Spartan',
  'brain.tier.spartan.hint': 'local only — cheapest and most private',
  'brain.tier.counsel': 'Counsel',
  'brain.tier.counsel.hint': 'hybrid — local first, cloud when needed',
  'brain.tier.senator': 'Senator',
  'brain.tier.senator.hint': 'cloud-first for max quality',
  'brain.ask_leader': 'Ask the Leader',
  'fleet.healthy': 'healthy',
  'fleet.disabled': 'disabled',
  'fleet.grants': 'grants',
  'fleet.lends': 'lends',
  'chat.placeholder': 'Ask a legal question, or give the Leader a config instruction…',
  'chat.send': 'Send',
  'chat.attach': 'Attach',
  'chat.confirm': 'Confirm',
  'chat.you': 'You',
  'chat.leader': 'Leader',
  'chat.grounded': 'grounded',
  'files.drop': 'Drop the file here or click to choose',
  'files.analyzing': 'Analyzing…',
  'files.placement': 'Placement suggestion',
};

export const fa: Record<keyof typeof en, string> = {
  'app.name': 'پلتفرم حقوقی',
  'app.tagline': 'مدیریت امور وکلا',
  'app.tagline.short': 'دفتر هوشمند وکالت',

  'tab.home': 'خانه',
  'tab.brain': 'اتصال مغز',
  'tab.fleet': 'ناوگان',
  'tab.chat': 'چت با لیدر',
  'tab.files': 'فایل‌ها',
  'tab.kitchen': 'آشپزخانه زنده',
  'tab.telecoms': 'مخابرات مشاوره',
  'tab.library': 'کتابخانه',
  'tab.drafts': 'پیش‌نویس‌ها',
  'tab.security': 'امنیت',
  'nav.more': 'بیشتر',

  'chrome.logout': 'خروج',
  'chrome.lang': 'English',
  'chrome.theme.dark': 'شب',
  'chrome.theme.light': 'روز',
  'chrome.tour': 'راهنما',

  'tour.next': 'بعدی',
  'tour.prev': 'قبلی',
  'tour.skip': 'رد کردن راهنما',
  'tour.done': 'متوجه شدم!',
  'tour.stepIndicator': 'گام',
  'tour.of': 'از',
  'tour.welcome.title': 'به دفتر هوشمندت خوش آمدی',
  'tour.welcome.body': 'این راهنمای کوتاه همهٔ میزکارها را قدم‌به‌قدم نشانت می‌دهد. هر وقت خواستی از دکمهٔ 💡 دوباره اجرا می‌شود. همه‌چیز دوزبانه است.',
  'tour.home.title': 'خانه — نمای امروز',
  'tour.home.body': 'موجودی کیف پول، صف نوبت و وضعیت مغز اینجاست. فقط‌خواندنی است: از این تب هیچی نمی‌شکند.',
  'tour.brain.title': 'اتصال مغز — به دفتر ذهن بده',
  'tour.brain.body': 'آدرس مدل محلی (کاملاً محرمانه) یا کلید API ابری را بچسبان. رازها فقط به سرور خودت می‌روند — هرگز پیش ما.',
  'tour.brain.try': 'یک مغز محلی نمونه پر کن',
  'tour.fleet.title': 'ناوگان — چه کسانی برایت کار می‌کنند',
  'tour.fleet.body': 'هر ایجنت کارشناس مهارت و شخصیت دارد. میز بین‌الملل به هر دو زبان فارسی و انگلیسی پاسخ می‌دهد.',
  'tour.chat.title': 'چت با لیدر — با حرف زدن دفتر را پیکربندی کن',
  'tour.chat.body': 'به لیدر بگو «پلتفرم را با انگلیسی ست کن» یا «برای آلمان کانفیگ کن». تغییر کانفیگ پیشنهاد می‌شود و تو تأیید می‌کنی.',
  'tour.files.title': 'فایل‌ها — اول تحلیل، بعد ادعا',
  'tour.files.body': 'هر فایلی را آپلود کن؛ تحلیل‌گر می‌گوید چیست و آیا OCR می‌خواهد، پیش از هر ادعایی.',
  'tour.kitchen.title': 'آشپزخانه زنده — ببین ایجنت‌ها چه می‌پزند',
  'tour.kitchen.body': 'هر تصمیم مسیریابی، انتخاب مدل و رویداد اینجا زنده استریم می‌شود. هیچ جعبهٔ سیاهی در کار نیست.',
  'tour.telecoms.title': 'مخابرات مشاوره — میز تلفن',
  'tour.telecoms.body': 'صف را باز/بسته کن، پلن‌های ۱۰/۲۰/۳۰ دقیقه‌ای بفروش، به مراجع بعدی خودکار اطلاع بده.',
  'tour.library.title': 'کتابخانه — قانون یعنی منبع',
  'tour.library.body': 'متن قانون را بچسبان یا از فایل‌ها قفسه کن. فقط corpus تأییدشده پاسخ را مستند می‌کند — استناد بیع ورود است.',
  'tour.library.try': 'مادهٔ نمونه را بچسبان',
  'tour.drafts.title': 'پیش‌نویس‌ها — استناد یا هیچ',
  'tour.drafts.body': 'پیش‌نویس فقط از منابع کتابخانه متولد می‌شود، سند تولد همراه دارد و منتظر تأیید تو می‌ماند. بدون بازبینی، تحویلی در کار نیست.',
  'tour.drafts.try': 'درخواست پیش‌نویس نمونه را پر کن',
  'tour.security.title': 'امنیت — نگهبان همیشه بیدار',
  'tour.security.body': 'نگهبان روزانه سکو را بر مبنای OWASP/ASVS/NIST از ۰ تا ۱۰ نمره می‌دهد و رگرسیون‌ها را به لیدر گزارش می‌کند.',
  'tour.security.try': 'همین حالا یک اسکن اجرا کن',

  'security.title': 'امنیت — نگهبان و تطابق استانداردها',
  'security.posture': 'امتیاز وضعیت امنیتی',
  'security.lastScan': 'آخرین بازرسی',
  'security.neverScanned': 'هنوز بازرسی نشده — نگهبان روزانه اجرا می‌شود',
  'security.standardsVersion': 'نسخه مجموعه استانداردها',
  'security.rescan': 'اجرای فوری بازرسی',
  'security.regressed': 'رگرسیون نسبت به دوره قبل',
  'security.improved': 'بهبود نسبت به دوره قبل',
  'security.check': 'کنترل',
  'security.refs': 'ارجاع استاندارد',
  'security.status': 'وضعیت',
  'security.evidence': 'شاهد / رفع',
  'security.notScannedYet': '— در انتظار اجرای بازرسی',

  'library.fake.title': 'کتابخانهٔ دانش',
  'library.search.cta': 'جستجو',
  'library.ingest.paste': 'چسباندن متن قانون',
  'library.ingest.file': 'قفسه کردن از فایل‌های آپلودشده',
  'library.verify': 'تأیید (بازبینی حقوقی انجام شد)',

  'drafts.title': 'پیش‌نویس‌ها',
  'drafts.usage': 'مصرف ماه جاری',
  'drafts.create': 'درخواست پیش‌نویس',
  'drafts.review.approve': 'تأیید',
  'drafts.review.reject': 'رد',
  'drafts.supersede': 'جایگزینی',
  'drafts.sources': 'منابع',

  'machines.title': 'توکن‌های ماشین',
  'machines.issue': 'صدور توکن',
  'machines.revoke': 'لغو',

  'kitchen.title': 'آشپزخانه زنده',
  'kitchen.subtitle': 'سکوی کار ایجنت‌ها — می‌بینی کی دارد چه می‌پزد',
  'kitchen.waiting': 'در انتظار رویداد… با لیدر حرف بزن تا اینجا زنده شود',
  'kitchen.event': 'رویداد',

  'auth.title': 'ورود به دفتر',
  'auth.phone': 'شماره موبایل',
  'auth.otp': 'کد تأیید',
  'auth.sendOtp': 'ارسال کد',
  'auth.verify': 'ورود',
  'auth.devToken': 'توکن توسعه (فقط سندباکس)',
  'auth.channel.phone': 'موبایل',
  'auth.channel.email': 'ایمیل',
  'auth.email': 'نشانی ایمیل',
  'auth.sendEmailOtp': 'کد را ایمیل کن',
'auth.devLogin': 'ورود توسعه',

  'ops.backup': 'نسخهٔ پشتیبان',
  'ops.backup.download': 'دانلود بستهٔ پشتیبان',
  'ops.backup.restore': 'بازیابی از بسته',
  'ops.backup.scopeNote': 'فقط کلیدهای runtime را پوشش می‌دهد — جدول‌های SQL به pg_dump جداگانه نیاز دارند.',

  'sample.law': 'ماده ۱۰ قانون مدنی — قراردادهای خصوصی، در صورتی که مخالف صریح قانون نباشند، نسبت به طرفین لازم‌الاجراست.',
  'sample.draftPrompt': 'نظر کارشناسی درباره فسخ قرارداد اجاره به علت عدم پرداخت اجاره سه ماه متوالی',

    // P8 — setup wizard + vault (passwords, passkeys, rotation bot)
  'wizard.title': 'جادوگر راه‌اندازی دفتر',
  'wizard.advance': 'انجام شد — برو جلو',
  'wizard.later': 'بعداً ادامه می‌دهم',
  'wizard.finish': 'تمام — بریم به دفتر',
  'wizard.resumeHint': 'هر وقت برگشتی از همینجا ادامه می‌دهد',
  'wizard.profile.country': 'کشور (مثلاً Iran / Germany)',
  'wizard.step.welcome.title': 'خوش آمدی — پنج دقیقه تا دفتر کامل',
  'wizard.step.welcome.body': 'چند گام کوتاه: معرفی، اتصال مغز، پلن مشاوره، منابع، بکاپ و امنیت. هر مرحله تب مرتبطش را باز می‌کند.',
  'wizard.step.profile.title': 'پروفایل دفتر و زبان',
  'wizard.step.profile.body': 'کشور و زبان پیش‌فرض را تنظیم کن — رابط هم راست/چپ‌چین و هم دوزبانه می‌شود؛ برای هر کشور قابل تغییر است.',
  'wizard.step.brain.title': 'اتصال مغز',
  'wizard.step.brain.body': 'مدل محلی یا کلید API ابری را در تب «اتصال مغز» وارد کن؛ پیش‌تنظیم «کانسل» ترکیبی است.',
  'wizard.step.plans.title': 'پلن‌های مشاوره تلفنی',
  'wizard.step.plans.body': 'دوره‌های ۱۰/۲۰/۳۰ دقیقه‌ای و قیمت‌گذاری در تب مخابرات. پیش‌فرض‌ها آماده‌اند.',
  'wizard.step.library.title': 'قفسهٔ اول کتابخانه',
  'wizard.step.library.body': 'حداقل یک متن قانون را قفسه کن — پاسخ‌ها فقط با منبع تأییدشده مستند می‌شوند.',
  'wizard.step.backup.title': 'بکاپ اول',
  'wizard.step.backup.body': 'بستهٔ پشتیبان runtime را از تب امنیت دانلود کن و جای امن بگذار.',
  'wizard.step.security.title': 'قفل ناحیه‌ها و پس‌کی',
  'wizard.step.security.body': 'برای config/vault/ops رمز اختصاصی بگذار، پس‌کی (اثر‌انگشت/چهره) وصل کن، ربات چرخش رمز را بشناس.',
  'wizard.step.done.title': 'همه‌چیز آماده است 🎉',
  'wizard.step.done.body': 'جادوگر تمام شد؛ دفتر تو برای کار روزمره آماده است — کد لیدر و تور راهنما همیشه دم دستند.',

  'vault.title': 'ربات پسورد و امنیت پنل',
  'vault.msg.lockSet': 'قفل ناحیه فعال شد.',
  'vault.msg.fail': 'ناموفق — طول رمز یا سیاست را چک کن.',
  'vault.msg.unlocked': 'بلیت ورود صادر شد (۱۲ ساعت).',
  'vault.msg.wrongPw': 'رمز اشتباه یا آی‌پی در قفل موقت است.',
  'vault.msg.passkeyAdded': 'پس‌کی ثبت شد (اثر انگشت/چهره فعال).',
  'vault.msg.rotated': 'چرخش کامل شد؛ فایل رمز دانلود شد.',
  'vault.rotation.title': 'ربات چرخش رمزها',
  'vault.rotation.never': 'هرگز نشده',
  'vault.rotation.rotateAll': 'چرخش همه رمزها — یک دکمه',
  'vault.rotation.note': 'رمزهای env سرور را خودتان در env عوض کنید — API به آنها دست نمی‌زند (صداقت).',
  'vault.locks.title': 'قفل ناحیه‌ای (دف وجه دوم)',
  'vault.locks.unlockPh': 'رمز ناحیه برای ورود…',
  'vault.locks.newPw': 'رمز جدید (حداقل ۸ نویسه)…',
  'vault.locks.unlock': 'باز کردن',
  'vault.locks.disable': 'برداشتن قفل',
  'vault.locks.set': 'فقر کن',
  'vault.locks.ticketAlive': 'بلیت فعال',
  'vault.passkey.title': 'پس‌کی (اثر انگشت / چهره)',
  'vault.passkey.hint': 'یاr WebAuthn؛ چالش یک‌بارمصرف، امضای دستگاه بدون خروج راز.',
  'vault.passkey.unsupported': 'این مرورگر getPublicKey را پشتیبانی نمی‌کند — سعی کن نسخهٔ جدید کروم/سافاری.',
  'vault.passkey.cancelled': 'عملیات لغو یا بی‌پاسخ ماند.',
  'vault.passkey.none': 'هنوز پس‌کی ثبت نشده است.',
  'vault.passkey.add': 'ثبت اثر انگشت/چهره',
  'vault.passkey.uses': 'استفاده:',

  // legacy keys carried over (P7 — never silently drop a UI string)
  'drafts.review.supersede': 'نسخهٔ جدید (supersede)',
  'home.title': 'دفتر حقوقی تو، با یک جامعه‌ای از کارشناس‌ها',
  'home.greeting.morning': 'صبح بخیر وکیل',
  'home.greeting.afternoon': 'ظهر بخیر وکیل',
  'home.greeting.evening': 'عصر بخیر وکیل',
  'home.system.details': 'وضعیت سیستم — یک نگاه، صادقانه',
  'home.kpi.brain': 'مغز لیدر',
  'home.kpi.brain.on': 'وصل است',
  'home.kpi.brain.off': 'وصل نیست',
  'home.kpi.deployment': 'استقرار',
  'home.kpi.theme': 'واژه‌نامهٔ تم',
  'home.lending': 'وضعیت قرضِ مغز لیدر',
  'home.preset': 'تیر فعال',
  'home.policy': 'سیاست استنتاج',
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
  'fleet.healthy': 'سالم',
  'fleet.disabled': 'غیرفعال',
  'fleet.grants': 'گرنت فعال',
  'fleet.lends': 'لیدر مغز قرض می‌دهد',
  'chat.placeholder': 'با لیدر حرف بزن… (مثلاً: «به مدل محلی وصل شو آدرس http://…»)',
  'chat.send': 'بفرست',
  'chat.attach': 'پیوست',
  'chat.confirm': 'بله، انجام بده',
  'chat.you': 'شما',
  'chat.leader': 'لیدر',
  'chat.grounded': 'مبتنی بر متن فایل',
  'files.drop': 'هر فایلی را اینجا بینداز',
  'files.analyzing': 'لیدر دارد می‌خواندش…',
  'files.placement': 'پیشنهاد جایگذاری',
};

/* ------------------------------------------------------------------ */
/* runtime prefs: locale + theme, reactive without a context provider  */
/* ------------------------------------------------------------------ */

export type Locale = 'fa' | 'en';
export type Theme = 'dark' | 'light';
export type TranslationKey = keyof typeof en;

export interface UiPrefs {
  locale: Locale;
  theme: Theme;
  tourSeen: boolean;
}

const PREFS_KEY = 'legal-platform:ui-prefs';
const PREFS_EVENT = 'legal-platform:ui-prefs-changed';

export const DEFAULT_PREFS: UiPrefs = { locale: 'fa', theme: 'dark', tourSeen: false };

export function isRtl(locale: Locale): boolean {
  return locale === 'fa';
}

export function getPrefs(): UiPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      locale: parsed.locale === 'en' ? 'en' : 'fa',
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      tourSeen: parsed.tourSeen === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(patch: Partial<UiPrefs>): UiPrefs {
  const next = { ...getPrefs(), ...patch };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(PREFS_EVENT));
  }
  return next;
}

export function prefsEventName(): string {
  return PREFS_EVENT;
}

/** t() reads CURRENT prefs; pass an override for SSR-ish deterministic spots. */
export function t(key: TranslationKey, localeOverride?: Locale): string {
  const locale = localeOverride ?? getPrefs().locale;
  if (locale === 'fa') {
    return (fa as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  }
  return (en as Record<string, string>)[key] ?? (fa as Record<string, string>)[key] ?? key;
}
