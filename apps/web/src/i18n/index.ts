/**
 * Interface text, language, direction and theme.
 *
 * - Keys are dot-separated names; components read text through t().
 * - Every English key must exist in Persian: the `fa` type enforces it.
 * - Language and theme are stored in localStorage. The office profile
 *   (`/dashboard/config/profile.defaultLocale`) sets the default for a first
 *   visit; after that the user's own choice wins.
 */

export const en = {
  'app.name': 'Legal Platform',
  'app.tagline': 'Smart practice workspace for lawyers',
  'app.tagline.short': 'Smart law office',

  // tabs
  'tab.home': 'Overview',
  'tab.brain': 'AI model',
  'tab.fleet': 'Expert assistants',
  'tab.chat': 'Assistant',
  'tab.files': 'Files',
  'tab.kitchen': 'Activity',
  'tab.telecoms': 'Phone consultations',
  'tab.library': 'Legal library',
  'tab.drafts': 'Drafts',
  'tab.security': 'Security',
  'nav.more': 'More',

  // chrome
  'chrome.logout': 'Sign out',
  'chrome.lang': 'فارسی',
  'chrome.theme.dark': 'Dark',
  'chrome.theme.light': 'Light',
  'chrome.tour': 'Guide',

  // onboarding tour
  'tour.next': 'Next',
  'tour.prev': 'Back',
  'tour.skip': 'Skip the guide',
  'tour.done': 'Got it',
  'tour.stepIndicator': 'Step',
  'tour.of': 'of',
  'tour.welcome.title': 'Welcome to your office',
  'tour.welcome.body': 'This short guide shows each section of the office. You can open it again at any time with the “Guide” button at the top.',
  'tour.home.title': 'Overview',
  'tour.home.body': 'Wallet balance, the consultation queue and the AI connection at a glance. This page only displays information.',
  'tour.brain.title': 'AI model',
  'tour.brain.body': 'Connect a model running on your own server (nothing leaves the office) or a cloud service with an API key. Keys are stored only on your server.',
  'tour.fleet.title': 'Expert assistants',
  'tour.fleet.body': 'Assistants for civil, criminal, family, registration and international matters. The international assistant answers in Persian and English.',
  'tour.chat.title': 'Assistant',
  'tour.chat.body': 'Ask legal questions or give settings instructions in plain language, for example “switch the interface to English”. Every settings change is proposed first and applied only after you confirm.',
  'tour.files.title': 'Files',
  'tour.files.body': 'Upload a file and the system identifies its type and whether it needs text recognition (OCR) before it is used.',
  'tour.kitchen.title': 'Activity',
  'tour.kitchen.body': 'Every routing decision, model choice and system event appears here as it happens.',
  'tour.telecoms.title': 'Phone consultations',
  'tour.telecoms.body': 'Open or close the queue, offer 10, 20 and 30-minute consultations, and notify the next client automatically.',
  'tour.library.title': 'Legal library',
  'tour.library.body': 'Add law texts by pasting them or from uploaded files. Only sources you have verified are used as citations.',
  'tour.library.try': 'Paste Article 10 of the Civil Code',
  'tour.drafts.title': 'Drafts',
  'tour.drafts.body': 'Drafts are written only from library sources, list their citations, and wait for your review. Nothing is delivered without your approval.',
  'tour.drafts.try': 'Fill in a typical request',
  'tour.security.title': 'Security',
  'tour.security.body': 'The platform is checked daily against OWASP ASVS and NIST controls and receives a score from 0 to 10. Any regression is reported.',
  'tour.security.try': 'Run a check now',

  // security tab
  'security.title': 'Security and standards compliance',
  'security.posture': 'Security score',
  'security.lastScan': 'Last check',
  'security.neverScanned': 'Not checked yet. Checks run daily.',
  'security.standardsVersion': 'Standards version',
  'security.rescan': 'Run a check now',
  'security.regressed': 'Worse than the previous check',
  'security.improved': 'Better than the previous check',
  'security.check': 'Control',
  'security.refs': 'Standard reference',
  'security.status': 'Status',
  'security.evidence': 'Evidence / remedy',
  'security.notScannedYet': 'Waiting for the first check',

  // library
  'library.search.cta': 'Search',
  'library.ingest.paste': 'Paste a law text',
  'library.ingest.file': 'Add from uploaded files',
  'library.verify': 'Mark as verified (legal review done)',

  // drafts
  'drafts.title': 'Drafts',
  'drafts.usage': 'Usage this month',
  'drafts.create': 'Request a draft',
  'drafts.review.approve': 'Approve',
  'drafts.review.reject': 'Reject',
  'drafts.supersede': 'New version',
  'drafts.sources': 'Sources',

  // machines
  'machines.title': 'Access tokens for integrations',
  'machines.issue': 'Issue token',
  'machines.revoke': 'Revoke',

  // activity
  'kitchen.title': 'Activity',
  'kitchen.subtitle': 'What the assistants are doing, as it happens',
  'kitchen.waiting': 'No activity yet. Send a message to the assistant to see events here.',
  'kitchen.event': 'Event',

  // auth
  'auth.title': 'Sign in to the office',
  'auth.phone': 'Mobile number',
  'auth.otp': 'Verification code',
  'auth.sendOtp': 'Send code',
  'auth.verify': 'Sign in',
  'auth.changePhone': 'Use a different number',
  'auth.changeEmail': 'Use a different email',
  'auth.devToken': 'Development token (development environment only)',
  'auth.devCode': 'Development environment: no text message was sent. Code:',
  'auth.notOffice': 'This account has no access to the office dashboard. The office owner is the phone number set as OWNER_PHONE during installation.',
  'auth.channel.phone': 'Mobile',
  'auth.channel.email': 'Email',
  'auth.email': 'Email address',
  'auth.sendEmailOtp': 'Email me the code',
  'auth.devLogin': 'Sign in with token',

  // ops / backup
  'ops.backup': 'Backup',
  'ops.backup.download': 'Download backup',
  'ops.backup.restore': 'Restore from backup',
  'ops.backup.scopeNote': 'This backup covers application settings and files only. The database is backed up on the server with scripts/backup.sh.',

  // real content used by tour "try" buttons
  'sample.law': 'ماده ۱۰ قانون مدنی: قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد نافذ است.',
  'sample.draftPrompt': 'نظر حقوقی دربارهٔ امکان فسخ قرارداد اجارهٔ مسکونی در صورت پرداخت‌نکردن اجاره‌بها از سوی مستأجر، با استناد به قانون مدنی و قانون روابط موجر و مستأجر مصوب ۱۳۷۶',

  // setup wizard + vault
  'wizard.title': 'Office setup',
  'wizard.advance': 'Done, next step',
  'wizard.later': 'Continue later',
  'wizard.start': 'Start setup',
  'wizard.stepOf': 'Step {n} of {total}',
  'wizard.openSection': 'Open this section',
  'wizard.expand': 'Expand setup panel',
  'wizard.collapse': 'Collapse setup panel',
  'wizard.error': 'This step could not be saved. Check the connection and try again.',
  'wizard.profile.language': 'Interface language',
  'wizard.finish': 'Finish and open the office',
  'wizard.resumeHint': 'You can continue from this step at any time, on any device.',
  'wizard.profile.country': 'Country',
  'wizard.step.welcome.title': 'Welcome',
  'wizard.step.welcome.body': 'A few short steps: office profile, AI model, consultation plans, legal sources, backup and security. You can open the related section from each step.',
  'wizard.step.profile.title': 'Office profile and language',
  'wizard.step.profile.body': 'Choose the office language and country. The language applies to the whole office right away and can be changed later.',
  'wizard.step.brain.title': 'Connect an AI model',
  'wizard.step.brain.body': 'Choose how answers are produced. Then, in the “AI model” section, enter the address of a local model or a cloud API key.',
  'wizard.step.plans.title': 'Phone consultation plans',
  'wizard.step.plans.body': 'Set 10, 20 and 30-minute durations and prices in “Phone consultations”. Default values are already in place.',
  'wizard.step.library.title': 'First library source',
  'wizard.step.library.body': 'Add at least one law text. Answers only cite verified sources.',
  'wizard.step.backup.title': 'First backup',
  'wizard.step.backup.body': 'Download a backup from the “Security” section and keep it somewhere safe.',
  'wizard.step.security.title': 'Section passwords and passkeys',
  'wizard.step.security.body': 'Set separate passwords for settings, keys and operations, register a passkey (fingerprint or face), and review password rotation.',
  'wizard.step.done.title': 'Everything is ready',
  'wizard.step.done.body': 'Setup is complete and the office is ready for daily work. The assistant and the guide are always one click away.',

  'vault.title': 'Access security',
  'vault.msg.lockSet': 'Section password set.',
  'vault.msg.fail': 'Not saved. Check the password length and rules.',
  'vault.msg.unlocked': 'Access granted for 12 hours.',
  'vault.msg.wrongPw': 'Wrong password, or too many attempts from this address. Try again later.',
  'vault.msg.passkeyAdded': 'Passkey registered.',
  'vault.msg.rotated': 'Machine tokens renewed. The file with the new values has been downloaded; store it somewhere safe.',
  'vault.rotation.title': 'Key and password age',
  'vault.rotation.never': 'never',
  'vault.rotation.rotateAll': 'Renew machine tokens',
  'vault.rotation.note': 'JWT keys are changed in the server .env file. Never change ENCRYPTION_MASTER_KEY: stored keys would become unreadable.',
  'vault.locks.title': 'Section passwords (second factor)',
  'vault.locks.unlockPh': 'Section password',
  'vault.locks.newPw': 'New password (at least 8 characters)',
  'vault.locks.unlock': 'Unlock',
  'vault.locks.disable': 'Remove password',
  'vault.locks.set': 'Set password',
  'vault.locks.ticketAlive': 'unlocked',
  'vault.passkey.title': 'Passkeys (fingerprint or face)',
  'vault.passkey.hint': 'Uses the WebAuthn standard: the private key never leaves your device.',
  'vault.passkey.unsupported': 'This browser does not support passkeys. Use a recent version of Chrome, Edge or Safari.',
  'vault.passkey.cancelled': 'The operation was cancelled or timed out.',
  'vault.passkey.none': 'No passkey registered yet.',
  'vault.passkey.add': 'Register a passkey',
  'vault.passkey.uses': 'Uses:',

  'drafts.review.supersede': 'Create a new version',
  'home.title': 'Today',
  'home.lending': 'Shared model',
  'home.preset': 'Preset',
  'home.policy': 'Model order',
  'home.model.both': 'A local model and a cloud service are both connected; the preset decides which is used first.',
  'home.model.cloud': 'Only a cloud service is connected; every assistant uses it.',
  'home.model.local': 'Only a local model is connected; every assistant uses it and data stays on your server.',
  'home.model.none': 'No model is connected yet; only rule-based answers are available.',
  'home.policy.local_only': 'Local model only',
  'home.policy.hybrid_local_first': 'Local first, then cloud',
  'home.policy.hybrid_cloud_first': 'Cloud first, then local',
  'home.jump.chat': 'Ask a legal question, send a file or give a settings instruction.',
  'home.jump.brain': 'Enter a local model address or a cloud API key; changes apply immediately.',
  'home.jump.kitchen': 'See which assistant is working, with which skill and on which model.',
  'home.jump.fleet': 'Skills, status and permissions of each expert assistant.',
  'home.jump.files': 'Upload a file; it is read before each answer and a storage location is suggested.',
  'home.sys.rateLimiter': 'Rate limiter',
  'home.sys.storage': 'Storage',
  'home.sys.multiReplica': 'Safe for multiple instances',
  'home.sys.yes': 'Yes',
  'home.sys.no': 'No',
  'home.greeting.morning': 'Good morning',
  'home.greeting.afternoon': 'Good afternoon',
  'home.greeting.evening': 'Good evening',
  'home.system.details': 'System status',
  'home.kpi.brain': 'AI model',
  'home.kpi.brain.on': 'connected',
  'home.kpi.brain.off': 'not connected',
  'home.kpi.deployment': 'Deployment',
  'home.kpi.theme': 'Theme',
  'brain.local': 'Local model',
  'brain.local.hint': 'Runs on your own server; no data leaves the office.',
  'brain.cloud': 'Cloud service',
  'brain.cloud.hint': 'External provider; usage is billed to your account.',
  'brain.baseUrl': 'Model address',
  'brain.model': 'Model name',
  'brain.apiKey': 'API key',
  'brain.test': 'Test connection',
  'brain.save': 'Save',
  'brain.source.runtime': 'set from the dashboard',
  'brain.source.env': 'from the .env file',
  'brain.source.none': 'not configured',
  'brain.tier.spartan': 'Economy',
  'brain.tier.spartan.hint': 'Local model only; lowest cost, highest privacy.',
  'brain.tier.counsel': 'Balanced',
  'brain.tier.counsel.hint': 'Local first, cloud when needed. Recommended.',
  'brain.tier.senator': 'Maximum quality',
  'brain.tier.senator.hint': 'Cloud first for the best answers.',
  'brain.ask_leader': 'You can also ask the assistant in plain language, for example: “switch to the maximum quality preset”.',
  'fleet.healthy': 'active',
  'fleet.disabled': 'disabled',
  'fleet.grants': 'permissions',
  'fleet.lends': 'Uses the main assistant’s model',
  'chat.placeholder': 'Ask a legal question or give a settings instruction…',
  'chat.send': 'Send',
  'chat.attach': 'Attach',
  'chat.confirm': 'Confirm',
  'chat.you': 'You',
  'chat.leader': 'Assistant',
  'chat.grounded': 'based on the file',
  'files.drop': 'Drop a file here or click to choose one',
  'files.analyzing': 'Analyzing…',
  'files.placement': 'Suggested placement',
  'auth.hint': 'Sign in with your mobile number or email.',
  'auth.passkey': 'Sign in with a passkey (fingerprint or face)',
  'auth.connError': 'Could not reach the server. Please try again in a moment.',
  'err.generic': 'The request failed',
  'err.AUTH_INVALID_CODE': 'The code is not correct.',
  'err.AUTH_CODE_EXPIRED': 'The code has expired. Request a new one.',
  'err.AUTH_RATE_LIMITED': 'Too many attempts. Please wait a few minutes and try again.',
  'err.AUTH_RESEND_COOLDOWN': 'A code was sent a moment ago. Please wait before requesting another.',
  'err.VALIDATION_INVALID_PHONE': 'Enter a valid Iranian mobile number: 11 digits starting with 09.',
  'err.VALIDATION_INVALID_INPUT': 'Please check the information you entered.',
  'err.PROVIDER_UNAVAILABLE': 'The text message could not be sent. Please try again later or sign in with email.',
  'err.AUTH_DEPENDENCY_DOWN': 'The server is not ready yet. Please try again in a moment.',

  // about & legal notices
  'about.title': 'About',
  'about.version': 'Version',
  'about.summary':
    'A self-hosted practice workspace for lawyers: cases, citation-backed drafts, online consultations and payments — on your own server, with your data under your control.',
  'about.author': 'Author',
  'about.authorName': 'Mohammad Ansari',
  'about.attribution': 'Original work by Mohammad Ansari — ansariai.ir',
  'about.website': 'Website',
  'about.contact': 'Contact',
  'about.contactNote': 'Automation projects and custom platform development',
  'about.license': 'License',
  'about.licenseNote':
    'Free software. You may use, study, modify and share it; keep the author credit, mark your changes, and publish the source of any version you offer to users.',
  'about.source': 'Source code',
  'about.donate': 'Support the project',
  'about.donateCta': 'Donate',
  'about.donateNote': 'If this project helps you, any amount you choose keeps it going.',
  'about.soon': 'Coming soon',
  'about.warranty': 'Provided without any warranty. Not a substitute for professional legal advice.',
  'about.close': 'Close',
};

export const fa: Record<keyof typeof en, string> = {
  'app.name': 'پلتفرم حقوقی',
  'app.tagline': 'دفتر کار هوشمند وکیل',
  'app.tagline.short': 'دفتر هوشمند وکالت',

  'tab.home': 'پیشخوان',
  'tab.brain': 'مدل هوش مصنوعی',
  'tab.fleet': 'دستیاران تخصصی',
  'tab.chat': 'دستیار',
  'tab.files': 'فایل‌ها',
  'tab.kitchen': 'فعالیت‌ها',
  'tab.telecoms': 'مشاورهٔ تلفنی',
  'tab.library': 'کتابخانهٔ حقوقی',
  'tab.drafts': 'پیش‌نویس‌ها',
  'tab.security': 'امنیت',
  'nav.more': 'بیشتر',

  'chrome.logout': 'خروج',
  'chrome.lang': 'English',
  'chrome.theme.dark': 'تیره',
  'chrome.theme.light': 'روشن',
  'chrome.tour': 'راهنما',

  'tour.next': 'بعدی',
  'tour.prev': 'قبلی',
  'tour.skip': 'رد شدن از راهنما',
  'tour.done': 'متوجه شدم',
  'tour.stepIndicator': 'گام',
  'tour.of': 'از',
  'tour.welcome.title': 'به دفتر خود خوش آمدید',
  'tour.welcome.body': 'این راهنمای کوتاه بخش‌های مختلف دفتر را معرفی می‌کند. هر زمان بخواهید با دکمهٔ «راهنما» در بالای صفحه دوباره آن را ببینید.',
  'tour.home.title': 'پیشخوان',
  'tour.home.body': 'موجودی کیف پول، صف مشاوره و وضعیت اتصال هوش مصنوعی در یک نگاه. این صفحه فقط اطلاعات را نمایش می‌دهد.',
  'tour.brain.title': 'مدل هوش مصنوعی',
  'tour.brain.body': 'مدلی را که روی سرور خودتان اجرا می‌شود (بدون خروج داده از دفتر) یا یک سرویس ابری با کلید API وصل کنید. کلیدها فقط روی سرور شما نگهداری می‌شوند.',
  'tour.fleet.title': 'دستیاران تخصصی',
  'tour.fleet.body': 'دستیارهای حقوق مدنی، کیفری، خانواده، ثبت و بین‌الملل. دستیار بین‌الملل به فارسی و انگلیسی پاسخ می‌دهد.',
  'tour.chat.title': 'دستیار',
  'tour.chat.body': 'پرسش حقوقی بپرسید یا دستور تنظیمات را به زبان ساده بنویسید؛ مثلاً «زبان رابط را انگلیسی کن». هر تغییر تنظیمات ابتدا پیشنهاد می‌شود و فقط پس از تأیید شما اعمال می‌شود.',
  'tour.files.title': 'فایل‌ها',
  'tour.files.body': 'فایل را بارگذاری کنید تا نوع آن و نیاز به تبدیل تصویر به متن (OCR) پیش از استفاده مشخص شود.',
  'tour.kitchen.title': 'فعالیت‌ها',
  'tour.kitchen.body': 'هر تصمیم مسیریابی، انتخاب مدل و رویداد سیستم در همین لحظه اینجا نمایش داده می‌شود.',
  'tour.telecoms.title': 'مشاورهٔ تلفنی',
  'tour.telecoms.body': 'صف را باز یا بسته کنید، مشاورهٔ ۱۰، ۲۰ و ۳۰ دقیقه‌ای ارائه دهید و نوبت بعدی به‌طور خودکار به مراجع اطلاع داده می‌شود.',
  'tour.library.title': 'کتابخانهٔ حقوقی',
  'tour.library.body': 'متن قوانین را با چسباندن یا از فایل‌های بارگذاری‌شده اضافه کنید. فقط منابعی که تأیید کرده‌اید به‌عنوان مستند به کار می‌روند.',
  'tour.library.try': 'چسباندن متن مادهٔ ۱۰ قانون مدنی',
  'tour.drafts.title': 'پیش‌نویس‌ها',
  'tour.drafts.body': 'پیش‌نویس‌ها فقط بر پایهٔ منابع کتابخانه نوشته می‌شوند، مستندات خود را فهرست می‌کنند و منتظر بازبینی شما می‌مانند. بدون تأیید شما چیزی تحویل داده نمی‌شود.',
  'tour.drafts.try': 'پرکردن یک درخواست رایج',
  'tour.security.title': 'امنیت',
  'tour.security.body': 'سامانه هر روز با کنترل‌های OWASP ASVS و NIST بررسی می‌شود و امتیازی از ۰ تا ۱۰ می‌گیرد. هر افتی گزارش می‌شود.',
  'tour.security.try': 'اجرای بررسی',

  'security.title': 'امنیت و انطباق با استانداردها',
  'security.posture': 'امتیاز امنیتی',
  'security.lastScan': 'آخرین بررسی',
  'security.neverScanned': 'هنوز بررسی نشده است. بررسی هر روز انجام می‌شود.',
  'security.standardsVersion': 'نسخهٔ استانداردها',
  'security.rescan': 'اجرای بررسی',
  'security.regressed': 'بدتر از بررسی قبلی',
  'security.improved': 'بهتر از بررسی قبلی',
  'security.check': 'کنترل',
  'security.refs': 'مرجع استاندارد',
  'security.status': 'وضعیت',
  'security.evidence': 'شاهد / راه رفع',
  'security.notScannedYet': 'در انتظار نخستین بررسی',

  'library.search.cta': 'جست‌وجو',
  'library.ingest.paste': 'چسباندن متن قانون',
  'library.ingest.file': 'افزودن از فایل‌های بارگذاری‌شده',
  'library.verify': 'تأیید (بازبینی حقوقی انجام شد)',

  'drafts.title': 'پیش‌نویس‌ها',
  'drafts.usage': 'مصرف ماه جاری',
  'drafts.create': 'درخواست پیش‌نویس',
  'drafts.review.approve': 'تأیید',
  'drafts.review.reject': 'رد',
  'drafts.supersede': 'نسخهٔ جدید',
  'drafts.sources': 'منابع',

  'machines.title': 'توکن‌های دسترسی برای یکپارچه‌سازی',
  'machines.issue': 'صدور توکن',
  'machines.revoke': 'لغو',

  'kitchen.title': 'فعالیت‌ها',
  'kitchen.subtitle': 'کارهایی که دستیاران در همین لحظه انجام می‌دهند',
  'kitchen.waiting': 'هنوز فعالیتی نیست. به دستیار پیام دهید تا رویدادها اینجا نمایش داده شوند.',
  'kitchen.event': 'رویداد',

  'auth.title': 'ورود به دفتر',
  'auth.phone': 'شمارهٔ موبایل',
  'auth.otp': 'کد تأیید',
  'auth.sendOtp': 'ارسال کد',
  'auth.verify': 'ورود',
  'auth.changePhone': 'تغییر شمارهٔ موبایل',
  'auth.changeEmail': 'تغییر ایمیل',
  'auth.devToken': 'توکن توسعه (فقط محیط توسعه)',
  'auth.devCode': 'محیط توسعه است و پیامکی ارسال نشد. کد:',
  'auth.notOffice': 'این حساب به داشبورد دفتر دسترسی ندارد. مالک دفتر همان شماره‌ای است که هنگام نصب در OWNER_PHONE ثبت شده است.',
  'auth.channel.phone': 'موبایل',
  'auth.channel.email': 'ایمیل',
  'auth.email': 'نشانی ایمیل',
  'auth.sendEmailOtp': 'ارسال کد به ایمیل',
  'auth.devLogin': 'ورود با توکن',

  'ops.backup': 'نسخهٔ پشتیبان',
  'ops.backup.download': 'دریافت نسخهٔ پشتیبان',
  'ops.backup.restore': 'بازیابی از نسخهٔ پشتیبان',
  'ops.backup.scopeNote': 'این نسخه فقط تنظیمات و فایل‌های برنامه را در بر می‌گیرد. پشتیبان پایگاه داده روی سرور با scripts/backup.sh گرفته می‌شود.',

  'sample.law': 'ماده ۱۰ قانون مدنی: قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند در صورتی که مخالف صریح قانون نباشد نافذ است.',
  'sample.draftPrompt': 'نظر حقوقی دربارهٔ امکان فسخ قرارداد اجارهٔ مسکونی در صورت پرداخت‌نکردن اجاره‌بها از سوی مستأجر، با استناد به قانون مدنی و قانون روابط موجر و مستأجر مصوب ۱۳۷۶',

  'wizard.title': 'راه‌اندازی دفتر',
  'wizard.advance': 'انجام شد، گام بعد',
  'wizard.later': 'بعداً ادامه می‌دهم',
  'wizard.start': 'شروع راه‌اندازی',
  'wizard.stepOf': 'گام {n} از {total}',
  'wizard.openSection': 'باز کردن این بخش',
  'wizard.expand': 'باز کردن پنل راه‌اندازی',
  'wizard.collapse': 'جمع کردن پنل راه‌اندازی',
  'wizard.error': 'این گام ذخیره نشد. اتصال را بررسی کنید و دوباره تلاش کنید.',
  'wizard.profile.language': 'زبان رابط',
  'wizard.finish': 'پایان و ورود به دفتر',
  'wizard.resumeHint': 'هر زمان و از هر دستگاهی می‌توانید از همین گام ادامه دهید.',
  'wizard.profile.country': 'کشور',
  'wizard.step.welcome.title': 'خوش آمدید',
  'wizard.step.welcome.body': 'چند گام کوتاه: مشخصات دفتر، مدل هوش مصنوعی، طرح‌های مشاوره، منابع حقوقی، نسخهٔ پشتیبان و امنیت. از هر گام می‌توانید بخش مربوط را باز کنید.',
  'wizard.step.profile.title': 'مشخصات دفتر و زبان',
  'wizard.step.profile.body': 'زبان و کشور دفتر را انتخاب کنید. زبان بلافاصله برای کل دفتر اعمال می‌شود و بعداً هم قابل تغییر است.',
  'wizard.step.brain.title': 'اتصال مدل هوش مصنوعی',
  'wizard.step.brain.body': 'شیوهٔ تولید پاسخ را انتخاب کنید. سپس در بخش «مدل هوش مصنوعی» نشانی مدل محلی یا کلید API سرویس ابری را وارد کنید.',
  'wizard.step.plans.title': 'طرح‌های مشاورهٔ تلفنی',
  'wizard.step.plans.body': 'مدت‌های ۱۰، ۲۰ و ۳۰ دقیقه و قیمت آن‌ها را در «مشاورهٔ تلفنی» تنظیم کنید. مقادیر پیش‌فرض آماده است.',
  'wizard.step.library.title': 'نخستین منبع کتابخانه',
  'wizard.step.library.body': 'دست‌کم یک متن قانونی اضافه کنید. پاسخ‌ها فقط به منابع تأییدشده استناد می‌کنند.',
  'wizard.step.backup.title': 'نخستین نسخهٔ پشتیبان',
  'wizard.step.backup.body': 'از بخش «امنیت» نسخهٔ پشتیبان را دریافت کنید و در جای امنی نگه دارید.',
  'wizard.step.security.title': 'رمز بخش‌ها و کلید عبور',
  'wizard.step.security.body': 'برای بخش‌های تنظیمات، کلیدها و عملیات رمز جداگانه بگذارید، کلید عبور (اثر انگشت یا چهره) ثبت کنید و چرخش رمزها را بررسی کنید.',
  'wizard.step.done.title': 'همه‌چیز آماده است',
  'wizard.step.done.body': 'راه‌اندازی تمام شد و دفتر برای کار روزانه آماده است. دستیار و راهنما همیشه در دسترس‌اند.',

  'vault.title': 'امنیت دسترسی',
  'vault.msg.lockSet': 'رمز بخش تنظیم شد.',
  'vault.msg.fail': 'ذخیره نشد. طول و قواعد رمز را بررسی کنید.',
  'vault.msg.unlocked': 'دسترسی برای ۱۲ ساعت باز شد.',
  'vault.msg.wrongPw': 'رمز نادرست است یا تلاش‌ها از این نشانی بیش از حد بوده است. کمی بعد دوباره تلاش کنید.',
  'vault.msg.passkeyAdded': 'کلید عبور ثبت شد.',
  'vault.msg.rotated': 'توکن‌های ماشینی نو شدند و فایل مقادیر جدید دریافت شد؛ آن را در جای امن نگه دارید.',
  'vault.rotation.title': 'عمر کلیدها و رمزها',
  'vault.rotation.never': 'هرگز',
  'vault.rotation.rotateAll': 'نوسازی توکن‌های ماشینی',
  'vault.rotation.note': 'کلیدهای JWT در فایل ‎.env‎ سرور عوض می‌شوند. ENCRYPTION_MASTER_KEY را هرگز عوض نکنید، وگرنه کلیدهای ذخیره‌شده دیگر خوانده نمی‌شوند.',
  'vault.locks.title': 'رمز بخش‌ها (عامل دوم)',
  'vault.locks.unlockPh': 'رمز بخش',
  'vault.locks.newPw': 'رمز جدید (دست‌کم ۸ نویسه)',
  'vault.locks.unlock': 'باز کردن',
  'vault.locks.disable': 'حذف رمز',
  'vault.locks.set': 'تنظیم رمز',
  'vault.locks.ticketAlive': 'باز است',
  'vault.passkey.title': 'کلید عبور (اثر انگشت یا چهره)',
  'vault.passkey.hint': 'بر پایهٔ استاندارد WebAuthn؛ کلید خصوصی هرگز از دستگاه شما خارج نمی‌شود.',
  'vault.passkey.unsupported': 'این مرورگر از کلید عبور پشتیبانی نمی‌کند. از نسخهٔ جدید Chrome، Edge یا Safari استفاده کنید.',
  'vault.passkey.cancelled': 'عملیات لغو شد یا مهلت آن تمام شد.',
  'vault.passkey.none': 'هنوز کلید عبوری ثبت نشده است.',
  'vault.passkey.add': 'ثبت کلید عبور',
  'vault.passkey.uses': 'دفعات استفاده:',

  'drafts.review.supersede': 'ساخت نسخهٔ جدید',
  'home.title': 'امروز',
  'home.greeting.morning': 'صبح بخیر',
  'home.greeting.afternoon': 'روز بخیر',
  'home.greeting.evening': 'عصر بخیر',
  'home.system.details': 'وضعیت سامانه',
  'home.kpi.brain': 'مدل هوش مصنوعی',
  'home.kpi.brain.on': 'متصل',
  'home.kpi.brain.off': 'متصل نیست',
  'home.kpi.deployment': 'استقرار',
  'home.kpi.theme': 'پوسته',
  'home.lending': 'مدل مشترک',
  'home.preset': 'پیش‌تنظیم',
  'home.policy': 'ترتیب استفاده',
  'home.model.both': 'مدل محلی و سرویس ابری هر دو متصل‌اند؛ پیش‌تنظیم تعیین می‌کند کدام اول استفاده شود.',
  'home.model.cloud': 'فقط سرویس ابری متصل است؛ همهٔ دستیاران از آن استفاده می‌کنند.',
  'home.model.local': 'فقط مدل محلی متصل است؛ همهٔ دستیاران از آن استفاده می‌کنند و داده از سرور شما خارج نمی‌شود.',
  'home.model.none': 'هنوز مدلی متصل نشده است؛ فقط پاسخ‌های قاعده‌محور و بدون مدل در دسترس‌اند.',
  'home.policy.local_only': 'فقط مدل محلی',
  'home.policy.hybrid_local_first': 'اول محلی، سپس ابری',
  'home.policy.hybrid_cloud_first': 'اول ابری، سپس محلی',
  'home.jump.chat': 'پرسش حقوقی بپرسید، فایل بفرستید یا دستور تنظیمات بدهید.',
  'home.jump.brain': 'نشانی مدل محلی یا کلید سرویس ابری را وارد کنید؛ تغییر بلافاصله اعمال می‌شود.',
  'home.jump.kitchen': 'ببینید کدام دستیار، با کدام مهارت و روی کدام مدل کار می‌کند.',
  'home.jump.fleet': 'مهارت‌ها، وضعیت و مجوزهای هر دستیار تخصصی.',
  'home.jump.files': 'فایل بارگذاری کنید؛ پیش از هر پاسخ خوانده می‌شود و محل نگهداری آن پیشنهاد می‌شود.',
  'home.sys.rateLimiter': 'محدودکنندهٔ درخواست',
  'home.sys.storage': 'محل ذخیره‌سازی',
  'home.sys.multiReplica': 'مناسب اجرای چندنسخه‌ای',
  'home.sys.yes': 'بله',
  'home.sys.no': 'خیر',
  'brain.local': 'مدل محلی',
  'brain.local.hint': 'روی سرور خودتان اجرا می‌شود و هیچ داده‌ای از دفتر خارج نمی‌شود.',
  'brain.cloud': 'سرویس ابری',
  'brain.cloud.hint': 'ارائه‌دهندهٔ بیرونی؛ هزینهٔ مصرف با حساب شماست.',
  'brain.baseUrl': 'نشانی مدل',
  'brain.model': 'نام مدل',
  'brain.apiKey': 'کلید API',
  'brain.test': 'آزمایش اتصال',
  'brain.save': 'ذخیره',
  'brain.source.runtime': 'تنظیم‌شده از داشبورد',
  'brain.source.env': 'از فایل ‎.env',
  'brain.source.none': 'تنظیم نشده',
  'brain.tier.spartan': 'اقتصادی',
  'brain.tier.spartan.hint': 'فقط مدل محلی؛ کمترین هزینه و بیشترین محرمانگی.',
  'brain.tier.counsel': 'متعادل',
  'brain.tier.counsel.hint': 'اول مدل محلی، در صورت نیاز ابری. پیشنهاد ما.',
  'brain.tier.senator': 'حداکثر کیفیت',
  'brain.tier.senator.hint': 'اولویت با سرویس ابری برای بهترین پاسخ.',
  'brain.ask_leader': 'می‌توانید از دستیار هم به زبان ساده بخواهید؛ مثلاً: «پیش‌تنظیم حداکثر کیفیت را فعال کن».',
  'fleet.healthy': 'فعال',
  'fleet.disabled': 'غیرفعال',
  'fleet.grants': 'مجوزها',
  'fleet.lends': 'از مدل دستیار اصلی استفاده می‌کند',
  'chat.placeholder': 'پرسش حقوقی یا دستور تنظیمات خود را بنویسید…',
  'chat.send': 'ارسال',
  'chat.attach': 'پیوست',
  'chat.confirm': 'تأیید',
  'chat.you': 'شما',
  'chat.leader': 'دستیار',
  'chat.grounded': 'بر پایهٔ متن فایل',
  'files.drop': 'فایل را اینجا رها کنید یا برای انتخاب کلیک کنید',
  'files.analyzing': 'در حال بررسی…',
  'files.placement': 'محل پیشنهادی',
  'auth.hint': 'با شمارهٔ موبایل یا ایمیل وارد شوید.',
  'auth.passkey': 'ورود با کلید عبور (اثر انگشت یا چهره)',
  'auth.connError': 'ارتباط با سرور برقرار نشد. چند لحظهٔ دیگر دوباره تلاش کنید.',
  'err.generic': 'درخواست انجام نشد',
  'err.AUTH_INVALID_CODE': 'کد واردشده درست نیست.',
  'err.AUTH_CODE_EXPIRED': 'مهلت کد تمام شده است. کد تازه بگیرید.',
  'err.AUTH_RATE_LIMITED': 'تعداد تلاش‌ها زیاد بود. چند دقیقه صبر کنید و دوباره تلاش کنید.',
  'err.AUTH_RESEND_COOLDOWN': 'کد همین حالا ارسال شد. کمی صبر کنید و بعد دوباره درخواست دهید.',
  'err.VALIDATION_INVALID_PHONE': 'یک شمارهٔ موبایل معتبر وارد کنید: ۱۱ رقم که با ۰۹ شروع شود.',
  'err.VALIDATION_INVALID_INPUT': 'اطلاعات واردشده را بررسی کنید.',
  'err.PROVIDER_UNAVAILABLE': 'پیامک ارسال نشد. کمی بعد دوباره تلاش کنید یا با ایمیل وارد شوید.',
  'err.AUTH_DEPENDENCY_DOWN': 'سرور هنوز آماده نیست. چند لحظهٔ دیگر دوباره تلاش کنید.',

  // درباره و اطلاعیه‌های حقوقی
  'about.title': 'درباره',
  'about.version': 'نسخه',
  'about.summary':
    'دفتر کار هوشمند وکیل که روی سرور خودتان نصب می‌شود: پرونده‌ها، پیش‌نویس با استناد، مشاورهٔ آنلاین و پرداخت — با داده‌هایی که فقط در اختیار خودتان است.',
  'about.author': 'سازنده',
  'about.authorName': 'محمد انصاری',
  'about.attribution': 'ساخته‌شده توسط محمد انصاری — ansariai.ir',
  'about.website': 'وب‌سایت',
  'about.contact': 'ارتباط',
  'about.contactNote': 'پروژه‌های اتوماسیون و ساخت پلتفرم اختصاصی',
  'about.license': 'مجوز',
  'about.licenseNote':
    'نرم‌افزار آزاد. استفاده، مطالعه، تغییر و انتشار آن آزاد است؛ به شرط حفظ نام سازنده، مشخص‌کردن تغییرات و انتشار کد منبعِ هر نسخه‌ای که در اختیار کاربران قرار می‌دهید.',
  'about.source': 'کد منبع',
  'about.donate': 'حمایت از پروژه',
  'about.donateCta': 'حمایت مالی',
  'about.donateNote': 'اگر این پروژه به کارتان آمده، با هر مبلغی که دوست دارید از ادامهٔ آن حمایت کنید.',
  'about.soon': 'به‌زودی',
  'about.warranty': 'بدون هیچ‌گونه ضمانت ارائه می‌شود و جایگزین مشاورهٔ حقوقی تخصصی نیست.',
  'about.close': 'بستن',
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

/** True when a translation exists for the key (used for dynamic keys such as error codes). */
export function hasKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** Formats a number with the digits of the current language (۱۲۳ in Persian, 123 in English). */
export function num(value: number, localeOverride?: Locale): string {
  const locale = localeOverride ?? getPrefs().locale;
  return value.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
}

/**
 * Inline bilingual text for one-off UI strings: `tx('ذخیره', 'Save')`.
 * Shared or reused strings belong in the dictionaries above.
 */
export function tx(faText: string, enText: string, localeOverride?: Locale): string {
  return (localeOverride ?? getPrefs().locale) === 'fa' ? faText : enText;
}

/** BCP-47 locale for dates and times in the current UI language. */
export function dateLocale(localeOverride?: Locale): string {
  return (localeOverride ?? getPrefs().locale) === 'fa' ? 'fa-IR' : 'en-GB';
}
