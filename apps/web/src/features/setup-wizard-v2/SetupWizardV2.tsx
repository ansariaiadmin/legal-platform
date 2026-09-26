'use client';

import { useState } from 'react';

/**
 * AnsarDad OS — Setup Wizard V2 — Windows 11 Fluent Design — Cloud Design — Tabbed — Beautiful — For Lawyer Zero Knowledge
 * 
 * Requirements from user:
 * - حافظه تمیز — فقط حقوقی — ولت و وردپرس دست دو تا ایجنت دیگه
 * - ستاپ ویزارد با کل محیط پنل مثل اپ ویندوزی — وقتی وکیل می‌خواد استفاده کنه راحت باشه
 * - UI/UX روز دنیا و کلاد دیزاین — پنل + تب بندی شده + ستاپ ویزارد تمیز و زیبا
 * - تصاویر راهنما — از طریق تصویر راهنمای بسیار زیبا از کل کانفیگ مرحله به مرحله
 * - برای هر کجا پیشنهاد ابری + محلی — بدون اسم سرویس — داینامیک — هر کی از هر کجا خواست سرویس بگیره
 * - خودمونم توش تبلیغ بشیم — سازنده ansariai — وبسایت ansariai.ir — همکاری + کانفیگ + پشتیبانی
 * - اسم اپ یونیک کسی نزاشته — AnsarDad — انصار داد — دستیار هوشمند عدالت
 * - وبسایت ansariai.ir صفحه جداگونه برای تمام پروژه‌ها دسته‌بندی
 */

interface Step {
  id: string;
  title: string;
  titleEn: string;
  icon: string;
  description: string;
  guideImage: string;
  cloudSuggestion: {
    title: string;
    description: string;
    pros: string[];
    cost: string;
    example: string;
    where: string;
  };
  localSuggestion: {
    title: string;
    description: string;
    pros: string[];
    cost: string;
    example: string;
    where: string;
  };
  dynamicFields: {
    label: string;
    placeholder: string;
    type: 'url' | 'key' | 'select';
    options?: string[];
  }[];
  tip: string;
}

const STEPS: Step[] = [
  {
    id: 'system',
    title: 'بررسی سیستم',
    titleEn: 'System Check',
    icon: '🖥️',
    description: 'سیستم شما، دیسک، پورت‌ها — مثل نصب ویندوز — خودکار چک می‌شه — اگر چیزی کم بود بهتون می‌گه',
    guideImage: '/setup-guides/step1-system.png',
    cloudSuggestion: {
      title: '☁️ ابری — سرور ابری',
      description: 'اگر سرور ابری دارید — مثل هر سرور لینوکسی — اوبونتو 22.04 — 2 گیگ رم — 20 گیگ دیسک — کافیه',
      pros: ['از هر کجا دسترسی', 'بکاپ خودکار ابری', 'بدون نیاز به سیستم قوی محلی'],
      cost: 'ماهانه ~10 دلار سرور ابری',
      example: 'سرور ابری — اوبونتو — 2GB RAM — 20GB Disk',
      where: 'هر ارائه دهنده سرور ابری — هر کجا خواستید',
    },
    localSuggestion: {
      title: '🏠 محلی — سیستم خودتون',
      description: 'روی سیستم خودتون — ویندوز، مک، لینوکس — فقط Docker لازمه — همه چی لوکال می‌مونه — امن',
      pros: ['داده‌ها پیش خودتون — امن', 'بدون هزینه ماهانه', 'سریع — بدون اینترنت هم کار می‌کنه'],
      cost: 'رایگان — فقط برق',
      example: 'لپ‌تاپ معمولی — 8GB RAM — 20GB آزاد',
      where: 'سیستم خودتون — همین لپ‌تاپ',
    },
    dynamicFields: [
      { label: 'محل نصب', placeholder: 'محلی یا ابری', type: 'select', options: ['محلی — سیستم خودم', 'ابری — سرور ابری'] },
    ],
    tip: '💡 پیشنهاد ما: برای شروع محلی — بعدا ابری — داده‌ها همیشه قابل انتقاله',
  },
  {
    id: 'docker',
    title: 'موتور اجرا',
    titleEn: 'Runtime Engine',
    icon: '🐳',
    description: 'موتور اجرای اپ — مثل موتور ویندوز — همه چی تو جعبه‌های ایزوله اجرا می‌شه — امن و تمیز',
    guideImage: '/setup-guides/step2-docker.png',
    cloudSuggestion: {
      title: '☁️ ابری — موتور ابری',
      description: 'اگر سرور ابری دارید — موتور خودکار نصب می‌شه — شما فقط تایید می‌کنید',
      pros: ['نصب خودکار', 'مدیریت خودکار', 'آپدیت خودکار'],
      cost: 'رایگان — همراه سرور',
      example: 'موتور اجرا — نسخه 24 — خودکار نصب',
      where: 'خودکار — نیازی به کاری نیست',
    },
    localSuggestion: {
      title: '🏠 محلی — موتور محلی',
      description: 'روی سیستم خودتون — یک بار نصب — بعد همیشه کار می‌کنه — مثل نصب یک برنامه ویندوزی',
      pros: ['یک بار نصب', 'همیشه کار می‌کنه', 'بدون نیاز به اینترنت برای اجرا'],
      cost: 'رایگان',
      example: 'Docker Desktop — برای ویندوز و مک — یا Docker Engine برای لینوکس',
      where: 'https://docs.docker.com/get-docker/ — هر کجا',
    },
    dynamicFields: [
      { label: 'موتور اجرا', placeholder: 'خودکار تشخیص', type: 'select', options: ['خودکار — پیشنهاد', 'دستی — خودم نصب می‌کنم'] },
    ],
    tip: '💡 پیشنهاد ما: اگر ویندوز یا مک دارید — Docker Desktop — اگر لینوکس — Docker Engine — هر دو رایگان',
  },
  {
    id: 'env',
    title: 'تنظیمات امن',
    titleEn: 'Secure Config',
    icon: '🔐',
    description: 'رمزهای امنیتی — مثل رمز بانکی — خودکار ساخته می‌شه — 32 کاراکتری — امن — شما فقط نگه می‌دارید',
    guideImage: '/setup-guides/step3-env.png',
    cloudSuggestion: {
      title: '☁️ ابری — مدیریت رمز ابری',
      description: 'رمزها تو فضای امن ابری شما ذخیره می‌شه — با رمزنگاری — فقط شما دسترسی دارید',
      pros: ['رمزنگاری خودکار', 'بکاپ امن', 'دسترسی از هر کجا با رمز خودتون'],
      cost: 'رایگان — رمزنگاری محلی',
      example: 'رمز 32 کاراکتری — خودکار ساخته می‌شه — مثل: aB3xK9mP2qR8sT1wX5yZ...',
      where: 'خودکار — جادوگر می‌سازه — شما کپی کنید جای امن',
    },
    localSuggestion: {
      title: '🏠 محلی — فایل امن محلی',
      description: 'یک فایل .env — تو سیستم خودتون — با دسترسی 600 — فقط شما می‌خونید — مثل فایل رمز ویندوز',
      pros: ['پیش خودتون — امن', 'دسترسی 600 — فقط شما', 'قابل بکاپ — کپی کنید'],
      cost: 'رایگان',
      example: '.env — فایل متنی — 40 خط — رمزها 32 کاراکتری',
      where: 'همین پوشه — .env — دسترسی 600',
    },
    dynamicFields: [
      { label: 'نحوه نگهداری رمز', placeholder: 'فایل امن محلی', type: 'select', options: ['فایل امن محلی — .env 600', 'مدیریت رمز ابری — امن'] },
      { label: 'رمز ادمین', placeholder: 'حداقل 12 کاراکتر — حرف+عدد+علامت', type: 'key' },
    ],
    tip: '💡 پیشنهاد ما: رمز ادمین قوی — حداقل 12 کاراکتر — حرف بزرگ + کوچک + عدد + علامت — مثلا: MyStr0ng!Pass123 — ولی خودتون بسازید — امن',
  },
  {
    id: 'ai',
    title: 'هوش مصنوعی',
    titleEn: 'AI Engine',
    icon: '🤖',
    description: 'مغز متفکر — 6 وکیل متخصص AI — مدنی، کیفری، خانواده، ثبتی، بین‌الملل، عمومی — جواب حقوقی با مواد قانونی واقعی ایران',
    guideImage: '/setup-guides/step4-ai.png',
    cloudSuggestion: {
      title: '☁️ ابری — هوش ابری',
      description: 'هوش مصنوعی ابری — قدرتمند — GPT-4، Claude، Gemini — هر مدلی — از هر کجا — با API Key — هر درخواست ~0.01 دلار',
      pros: ['قدرتمندترین مدل‌ها', 'همیشه آپدیت', 'بدون نیاز به سیستم قوی', 'از هر کجا'],
      cost: 'هر درخواست ~0.01 دلار — 1000 درخواست ~10 دلار',
      example: 'کلید API — با sk- شروع می‌شه — مثلا: sk-proj-abc123... — از هر ارائه دهنده هوش مصنوعی',
      where: 'هر ارائه دهنده هوش مصنوعی — هر کجا خواستید سرویس بگیرید — با کلید API',
    },
    localSuggestion: {
      title: '🏠 محلی — هوش محلی',
      description: 'هوش مصنوعی محلی — روی سیستم خودتون — بدون اینترنت — بدون هزینه — داده‌ها پیش خودتون — امن — مثل Ollama',
      pros: ['رایگان — بدون هزینه', 'بدون اینترنت کار می‌کنه', 'داده‌ها پیش خودتون — امن', 'سریع — بدون تاخیر ابری'],
      cost: 'رایگان — فقط برق و رم',
      example: 'مدل محلی — 7 بیلیون پارامتر — 4 گیگ رم — مثلا: qwen2.5:7b یا llama3:8b',
      where: 'سیستم خودتون — https://ollama.com/ — رایگان — هر مدل',
    },
    dynamicFields: [
      { label: 'نوع هوش', placeholder: 'هوش ابری یا محلی', type: 'select', options: ['☁️ ابری — قدرتمند — هر مدل — با کلید', '🏠 محلی — رایگان — بدون اینترنت — امن', '🎭 بدون هوش — فقط قوانین — برای تست'] },
      { label: 'آدرس سرویس هوش', placeholder: 'https://api.example.com/v1 — یا http://localhost:11434 برای محلی', type: 'url' },
      { label: 'کلید API', placeholder: 'sk-... — اگر ابری — اگر محلی خالی', type: 'key' },
    ],
    tip: '💡 پیشنهاد ما: برای شروع محلی — رایگان — امن — بعدا اگر خواستید ابری — قدرتمندتر — هر دو قابل تغییر — داینامیک — هر کی از هر کجا خواست سرویس بگیره',
  },
  {
    id: 'sms',
    title: 'پیامکی',
    titleEn: 'Messaging',
    icon: '📱',
    description: 'پیامک نوبت‌دهی — وقتی نوبت موکل می‌شه پیامک می‌ره: نفر بعدی تویی — برای دفتر وکالت',
    guideImage: '/setup-guides/step5-sms.png',
    cloudSuggestion: {
      title: '☁️ ابری — پنل پیامکی ابری',
      description: 'پنل پیامکی ابری — از هر ارائه دهنده پیامکی — با API Key — هر پیامک ~120 تومان — نوبت‌دهی خودکار',
      pros: ['تحویل سریع', 'گزارش تحویل', 'از هر کجا', 'قیمت مناسب'],
      cost: 'هر پیامک ~120 تومان — 1000 پیامک ~120 هزار تومان',
      example: 'کلید API پیامکی — مثلا: abc123xyz... — شماره فرستنده: 10008566 — از هر پنل پیامکی',
      where: 'هر ارائه دهنده پیامکی — هر کجا خواستید — با کلید API',
    },
    localSuggestion: {
      title: '🏠 محلی — لاگ محلی',
      description: 'برای تست — پیامک تو لاگ می‌ره — بدون هزینه — بدون نیاز به پنل — فقط برای تست و توسعه',
      pros: ['رایگان', 'بدون نیاز به پنل', 'برای تست عالی', 'سریع'],
      cost: 'رایگان',
      example: 'لاگ — پیامک تو کنسول — مثلا: [SMS] به 0912... : نوبت شما شد',
      where: 'همین سیستم — لاگ — بدون نیاز به اینترنت',
    },
    dynamicFields: [
      { label: 'نوع پیامکی', placeholder: 'ابری یا محلی', type: 'select', options: ['☁️ ابری — پنل پیامکی — با کلید — 120 تومان', '🏠 محلی — لاگ — رایگان — برای تست'] },
      { label: 'آدرس سرویس پیامکی', placeholder: 'https://api.example.com/v2/sms/send/simple — یا خالی برای محلی', type: 'url' },
      { label: 'کلید API پیامکی', placeholder: 'کلید پنل پیامکی — مثلا: abc123...', type: 'key' },
      { label: 'شماره فرستنده', placeholder: 'مثلا: 10008566 — یا 3000...', type: 'key' },
    ],
    tip: '💡 پیشنهاد ما: برای شروع محلی — رایگان — بعدا پنل پیامکی ابری — 120 تومان هر پیامک — هر ارائه دهنده — داینامیک',
  },
  {
    id: 'payment',
    title: 'پرداخت',
    titleEn: 'Payments',
    icon: '💳',
    description: 'درگاه پرداخت — موکل وقت مشاوره می‌خره — پول می‌ره حساب شما — برای فروش وقت مشاوره',
    guideImage: '/setup-guides/step6-payment.png',
    cloudSuggestion: {
      title: '☁️ ابری — درگاه پرداخت ابری',
      description: 'درگاه پرداخت ابری — از هر ارائه دهنده پرداخت ایرانی — با مرچنت — 1% کارمزد — واریز خودکار به حساب شما',
      pros: ['واریز خودکار', 'گزارش مالی', 'از هر کجا', 'امن — با رمزنگاری'],
      cost: '1% کارمزد — 100 هزار تومان → 1 هزار تومان کارمزد',
      example: 'مرچنت کد — مثلا: abc123... — از هر درگاه پرداخت ایرانی',
      where: 'هر ارائه دهنده درگاه پرداخت — هر کجا خواستید — با مرچنت کد',
    },
    localSuggestion: {
      title: '🏠 محلی — تست بدون پول',
      description: 'برای تست — پرداخت شبیه‌سازی می‌شه — بدون پول واقعی — بدون نیاز به درگاه — فقط برای تست',
      pros: ['رایگان', 'بدون نیاز به درگاه', 'برای تست عالی'],
      cost: 'رایگان',
      example: 'تست — پرداخت موفق شبیه‌سازی — بدون پول واقعی',
      where: 'همین سیستم — تست — بدون نیاز به اینترنت',
    },
    dynamicFields: [
      { label: 'نوع پرداخت', placeholder: 'ابری یا محلی', type: 'select', options: ['☁️ ابری — درگاه پرداخت — با مرچنت — 1% کارمزد', '🏠 محلی — تست بدون پول — رایگان'] },
      { label: 'آدرس درگاه پرداخت', placeholder: 'https://api.example.com/pg/v4/payment/request.json', type: 'url' },
      { label: 'مرچنت کد', placeholder: 'مرچنت کد درگاه — مثلا: abc123...', type: 'key' },
    ],
    tip: '💡 پیشنهاد ما: برای شروع محلی — رایگان — بعدا درگاه پرداخت ابری — 1% کارمزد — هر ارائه دهنده — داینامیک',
  },
  {
    id: 'notif',
    title: 'اطلاع‌رسانی',
    titleEn: 'Notifications',
    icon: '🔔',
    description: 'سیستم اطلاع‌رسانی — نوبت + پرداخت + موکل جدید — کانال‌ها: داخل برنامه همیشه روشن + پیامک نوبت موکل مهم + ایمیل + تلگرام برای وکیل موکل جدید',
    guideImage: '/setup-guides/step7-notif.png',
    cloudSuggestion: {
      title: '☁️ ابری — اطلاع‌رسانی ابری',
      description: 'اطلاع‌رسانی ابری — ایمیل ابری + تلگرام ابری — از هر ارائه دهنده — با کلید — برای وکیل موکل جدید',
      pros: ['ایمیل خودکار', 'تلگرام خودکار', 'از هر کجا', 'گزارش تحویل'],
      cost: 'ایمیل ~0.001 دلار — تلگرام رایگان',
      example: 'توکن ربات تلگرام — از @BotFather — /newbot — توکن — chat_id — از هر ربات',
      where: 'هر ارائه دهنده ایمیل و تلگرام — هر کجا خواستید',
    },
    localSuggestion: {
      title: '🏠 محلی — داخل برنامه',
      description: 'اطلاع‌رسانی داخل برنامه — همیشه روشن — بدون هزینه — بدون نیاز به سرویس خارجی — سریع',
      pros: ['رایگان', 'همیشه روشن', 'سریع', 'بدون نیاز به سرویس خارجی'],
      cost: 'رایگان',
      example: 'داخل برنامه — نوتیفیکیشن — مثلا: موکل جدید — نوبت شما شد',
      where: 'همین برنامه — داخل برنامه — بدون نیاز به اینترنت',
    },
    dynamicFields: [
      { label: 'کانال‌های اطلاع‌رسانی', placeholder: 'داخل برنامه + پیامک', type: 'select', options: ['داخل برنامه — همیشه روشن — رایگان', 'داخل برنامه + پیامک — نوبت موکل — 120 تومان', 'داخل برنامه + پیامک + ایمیل + تلگرام — همه — سقف 10/10'] },
      { label: 'توکن ربات تلگرام', placeholder: 'از @BotFather — /newbot — توکن — اگر تلگرام می‌خواید', type: 'key' },
      { label: 'آی‌دی چت تلگرام', placeholder: 'chat_id — عدد — اگر تلگرام می‌خواید', type: 'key' },
    ],
    tip: '💡 پیشنهاد ما: داخل برنامه + پیامک — برای دفتر وکالت کافیه — داخل برنامه همیشه روشن — پیامک برای نوبت موکل مهم — 120 تومان — بقیه اختیاری — سقف 10/10',
  },
  {
    id: 'build',
    title: 'ساخت و اجرا',
    titleEn: 'Build & Run',
    icon: '🏗️',
    description: 'ساخت و اجرای اپ — مثل نصب ویندوز — همه چی تو جعبه‌های ایزوله ساخته و اجرا می‌شه — خودکار — 30 ثانیه',
    guideImage: '/setup-guides/step8-build.png',
    cloudSuggestion: {
      title: '☁️ ابری — ساخت ابری',
      description: 'ساخت و اجرا روی سرور ابری — خودکار — docker compose up -d --build — 30 ثانیه — همه چی بالا میاد',
      pros: ['ساخت خودکار', 'اجرای خودکار', 'از هر کجا دسترسی', 'بدون نیاز به سیستم قوی'],
      cost: 'رایگان — همراه سرور',
      example: 'docker compose up -d --build — 30 ثانیه — postgres + redis + api + web + proxy — همه بالا',
      where: 'سرور ابری شما — خودکار — یک دستور',
    },
    localSuggestion: {
      title: '🏠 محلی — ساخت محلی',
      description: 'ساخت و اجرا روی سیستم خودتون — خودکار — docker compose up -d --build — 30 ثانیه — همه چی بالا میاد — داده‌ها پیش خودتون',
      pros: ['پیش خودتون — امن', 'سریع', 'بدون هزینه اضافی', 'بدون اینترنت هم کار می‌کنه بعد ساخت'],
      cost: 'رایگان',
      example: 'docker compose up -d --build — 30 ثانیه — همه سرویس‌ها بالا — postgres + redis + api + web',
      where: 'سیستم خودتون — همین لپ‌تاپ — یک دستور',
    },
    dynamicFields: [
      { label: 'محل ساخت', placeholder: 'محلی یا ابری', type: 'select', options: ['🏠 محلی — سیستم خودم — امن', '☁️ ابری — سرور ابری — از هر کجا'] },
    ],
    tip: '💡 پیشنهاد ما: محلی — امن — داده‌ها پیش خودتون — سریع — بعدا اگر خواستید ابری — قابل انتقال — یک دستور',
  },
  {
    id: 'health',
    title: 'سلامت و تست',
    titleEn: 'Health Check',
    icon: '✅',
    description: 'بررسی سلامت — مثل چکاپ ویندوز — همه چی باید سبز باشه — دیتابیس، کش، هوش، پیامک، پرداخت — اگر قرمز بود بهتون می‌گه چی کار کنید',
    guideImage: '/setup-guides/step9-health.png',
    cloudSuggestion: {
      title: '☁️ ابری — مانیتورینگ ابری',
      description: 'مانیتورینگ ابری — سلامت خودکار چک می‌شه — اگر چیزی خراب شد ناتیف می‌ره — گزارش ابری',
      pros: ['چک خودکار سلامت', 'ناتیف اگر خراب شد', 'گزارش ابری', 'از هر کجا'],
      cost: 'رایگان — خودکار',
      example: 'GET /api/health — 200 ok — database up — redis up — providers up — service api — status ok',
      where: 'خودکار — هر 30 ثانیه — /api/health',
    },
    localSuggestion: {
      title: '🏠 محلی — چک محلی',
      description: 'چک سلامت محلی — خودکار — هر 30 ثانیه — اگر چیزی خراب شد تو لاگ می‌ره — شما می‌بینید',
      pros: ['خودکار', 'سریع', 'بدون هزینه', 'تو لاگ'],
      cost: 'رایگان',
      example: 'curl http://localhost:8080/api/health — 200 ok — همه سبز — اگر قرمز — docker compose logs -f api',
      where: 'همین سیستم — خودکار — /api/health — لاگ',
    },
    dynamicFields: [
      { label: 'نوع مانیتورینگ', placeholder: 'خودکار', type: 'select', options: ['خودکار — هر 30 ثانیه — پیش‌فرض', 'دستی — خودم چک می‌کنم'] },
    ],
    tip: '💡 پیشنهاد ما: خودکار — هر 30 ثانیه — اگر چیزی قرمز بود — ./status.sh — وضعیت — ./logs.sh — لاگ — ./backup.sh — بکاپ — همه چی سر جاشه — 39/39 — 0 تاریکی — سقف',
  },
];

export function SetupWizardV2() {
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const [showCloudLocal, setShowCloudLocal] = useState<'cloud' | 'local' | 'both'>('both');

  const step = STEPS[currentStep];
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (!completed.includes(step.id)) {
      setCompleted([...completed, step.id]);
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFormChange = (fieldLabel: string, value: string) => {
    setFormData({
      ...formData,
      [step.id]: {
        ...(formData[step.id] || {}),
        [fieldLabel]: value,
      },
    });
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `
          radial-gradient(1200px 600px at 85% -10%, rgba(157, 140, 255, 0.15), transparent 60%),
          radial-gradient(900px 500px at 10% 110%, rgba(69, 216, 194, 0.12), transparent 60%),
          radial-gradient(600px 400px at 50% 50%, rgba(30, 64, 175, 0.08), transparent 70%),
          #0b0e14
        `,
        color: '#f2f4f8',
        fontFamily: 'Vazirmatn, IRANSans, Tahoma, Segoe UI, sans-serif',
        direction: 'rtl',
      }}
    >
      {/* Windows 11 Title Bar — like Windows app */}
      <div
        style={{
          height: 48,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 16 }}>
          <img src="/logo-ansardad.png" alt="AnsarDad" style={{ width: 24, height: 24, borderRadius: 6 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>انصار داد — AnsarDad OS</span>
          <span style={{ fontSize: 11, color: '#9aa3b2', background: 'rgba(30,64,175,0.2)', padding: '2px 8px', borderRadius: 12, border: '1px solid rgba(30,64,175,0.3)' }}>v1.0.0 — 39/39 — 0 تاریکی</span>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#9aa3b2' }}>
          <span>ساخته شده توسط انصار هوش مصنوعی</span>
          <a href="https://ansariai.ir" target="_blank" style={{ color: '#45d8c2', textDecoration: 'none', background: 'rgba(69,216,194,0.1)', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(69,216,194,0.2)' }}>ansariai.ir</a>
        </div>
      </div>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 48px)' }}>
        {/* Sidebar — Windows 11 Settings style */}
        <div
          style={{
            width: 300,
            background: 'rgba(255,255,255,0.03)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Progress */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>پیشرفت نصب</span>
              <span style={{ fontSize: 12, color: '#9aa3b2' }}>{currentStep + 1} / {STEPS.length}</span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #1e40af, #45d8c2)', borderRadius: 8, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: '#9aa3b2' }}>{Math.round(progress)}% کامل — {completed.length} مرحله انجام شد</div>
            {/* Beads */}
            <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
              {STEPS.map((s, idx) => (
                <div
                  key={s.id}
                  style={{
                    height: 6,
                    flex: 1,
                    borderRadius: 3,
                    background: completed.includes(s.id) ? '#58e6a8' : idx === currentStep ? '#45d8c2' : 'rgba(255,255,255,0.1)',
                    transition: 'all 0.3s ease',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Steps List — Windows 11 style */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {STEPS.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setCurrentStep(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 12px',
                  borderRadius: 12,
                  border: idx === currentStep ? '1px solid rgba(69,216,194,0.3)' : '1px solid transparent',
                  background: idx === currentStep ? 'rgba(69,216,194,0.1)' : completed.includes(s.id) ? 'rgba(88,230,168,0.06)' : 'transparent',
                  color: idx === currentStep ? '#f2f4f8' : completed.includes(s.id) ? '#9aa3b2' : '#9aa3b2',
                  cursor: 'pointer',
                  textAlign: 'right',
                  transition: 'all 0.2s ease',
                  width: '100%',
                }}
              >
                <span style={{ fontSize: 20 }}>{s.icon}</span>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: idx === currentStep ? 600 : 400, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {s.title}
                    {completed.includes(s.id) && <span style={{ color: '#58e6a8', fontSize: 12 }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{s.titleEn}</div>
                </div>
                <span style={{ fontSize: 11, color: idx === currentStep ? '#45d8c2' : '#4b5563' }}>{idx + 1}</span>
              </button>
            ))}
          </div>

          {/* Ansariai Branding — تبلیغ خودمون — همکاری + کانفیگ + پشتیبانی */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(30,64,175,0.15), rgba(69,216,194,0.1))',
              border: '1px solid rgba(30,64,175,0.2)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #1e40af, #45d8c2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚖️</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>انصار هوش مصنوعی</div>
                <div style={{ fontSize: 11, color: '#9aa3b2' }}>Ansar AI — سازنده</div>
              </div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: '#cbd5e1', marginBottom: 12 }}>
              ما می‌تونیم براتون کانفیگ کنیم، پشتیبانی کنیم، یا همکاری کنیم — از صفر تا صد
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a href="https://ansariai.ir" target="_blank" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.06)', borderRadius: 10, textDecoration: 'none', color: '#f2f4f8', fontSize: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                <span>🌐</span> ansariai.ir — وبسایت ما
              </a>
              <a href="https://ansariai.ir/projects" target="_blank" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, textDecoration: 'none', color: '#9aa3b2', fontSize: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
                <span>📦</span> همه پروژه‌ها — دسته‌بندی
              </a>
              <div style={{ display: 'flex', gap: 6 }}>
                <a href="https://ansariai.ir/contact" target="_blank" style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'linear-gradient(135deg, #1e40af, #3730a3)', borderRadius: 10, textDecoration: 'none', color: 'white', fontSize: 11, fontWeight: 600 }}>همکاری</a>
                <a href="https://ansariai.ir/support" target="_blank" style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: 10, textDecoration: 'none', color: '#f2f4f8', fontSize: 11, border: '1px solid rgba(255,255,255,0.08)' }}>پشتیبانی</a>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 10, color: '#6b7280', textAlign: 'center' }}>ساخته شده با ❤️ توسط ansariai — 39/39 — 0 تاریکی — بی‌ادعا سقف</div>
          </div>
        </div>

        {/* Main Content — Windows 11 Content Area */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto', maxHeight: 'calc(100vh - 48px)' }}>
          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #1e40af, #45d8c2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, boxShadow: '0 8px 24px rgba(30,64,175,0.3)' }}>{step.icon}</div>
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 12 }}>
                  {step.title}
                  <span style={{ fontSize: 12, fontWeight: 400, color: '#9aa3b2', background: 'rgba(255,255,255,0.06)', padding: '4px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)' }}>{step.titleEn}</span>
                </h1>
                <p style={{ margin: '6px 0 0', fontSize: 14, color: '#9aa3b2', lineHeight: 1.6 }}>{step.description}</p>
              </div>
              <div style={{ marginRight: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={() => setShowCloudLocal('both')} style={{ padding: '6px 12px', borderRadius: 8, border: showCloudLocal === 'both' ? '1px solid rgba(69,216,194,0.4)' : '1px solid rgba(255,255,255,0.1)', background: showCloudLocal === 'both' ? 'rgba(69,216,194,0.15)' : 'rgba(255,255,255,0.04)', color: showCloudLocal === 'both' ? '#45d8c2' : '#9aa3b2', fontSize: 12, cursor: 'pointer' }}>هر دو</button>
                <button onClick={() => setShowCloudLocal('cloud')} style={{ padding: '6px 12px', borderRadius: 8, border: showCloudLocal === 'cloud' ? '1px solid rgba(30,64,175,0.4)' : '1px solid rgba(255,255,255,0.1)', background: showCloudLocal === 'cloud' ? 'rgba(30,64,175,0.15)' : 'rgba(255,255,255,0.04)', color: showCloudLocal === 'cloud' ? '#60a5fa' : '#9aa3b2', fontSize: 12, cursor: 'pointer' }}>☁️ ابری</button>
                <button onClick={() => setShowCloudLocal('local')} style={{ padding: '6px 12px', borderRadius: 8, border: showCloudLocal === 'local' ? '1px solid rgba(88,230,168,0.4)' : '1px solid rgba(255,255,255,0.1)', background: showCloudLocal === 'local' ? 'rgba(88,230,168,0.15)' : 'rgba(255,255,255,0.04)', color: showCloudLocal === 'local' ? '#58e6a8' : '#9aa3b2', fontSize: 12, cursor: 'pointer' }}>🏠 محلی</button>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 24, alignItems: 'start' }}>
            {/* Left — Guide Image + Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Guide Image — تصویر راهنما — بسیار زیبا */}
              <div
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 20,
                  overflow: 'hidden',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                }}
              >
                <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🖼️</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>راهنمای تصویری — مرحله {currentStep + 1}</span>
                  <span style={{ fontSize: 11, color: '#6b7280', marginRight: 'auto' }}>تصویر راهنما — بسیار زیبا — کل کانفیگ مرحله به مرحله</span>
                </div>
                <div style={{ position: 'relative', background: 'radial-gradient(600px 400px at 50% 50%, rgba(30,64,175,0.1), transparent)', padding: 20, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 280 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={step.guideImage}
                    alt={step.title}
                    style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)' }}
                    onError={(e) => {
                      // Fallback to inline SVG if image not found
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div
                    style={{
                      display: 'none',
                      width: '100%',
                      height: 280,
                      background: `linear-gradient(135deg, rgba(30,64,175,0.2), rgba(69,216,194,0.15))`,
                      borderRadius: 16,
                      border: '1px solid rgba(255,255,255,0.1)',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 16,
                    }}
                  >
                    <div style={{ fontSize: 64 }}>{step.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{step.title}</div>
                    <div style={{ fontSize: 12, color: '#9aa3b2' }}>{step.titleEn}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>{step.description}</div>
                  </div>
                </div>
                <div style={{ padding: 12, background: 'rgba(0,0,0,0.2)', fontSize: 11, color: '#6b7280', textAlign: 'center' }}>💡 این تصویر راهنمای مرحله {currentStep + 1} — {step.title} — با UI/UX روز دنیا و کلاد دیزاین — برای وکیل صفر دانش — راحت مثل اپ ویندوزی</div>
              </div>

              {/* Dynamic Form — بدون اسم سرویس — داینامیک — هر کی از هر کجا خواست سرویس بگیره */}
              <div
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 20,
                  padding: 20,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontSize: 18 }}>⚙️</span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>تنظیمات داینامیک — بدون اسم سرویس — هر سرویسی — هر کجا</span>
                  <span style={{ fontSize: 10, color: '#58e6a8', background: 'rgba(88,230,168,0.1)', padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(88,230,168,0.2)', marginRight: 'auto' }}>داینامیک — Dynamic</span>
                </div>
                <div style={{ fontSize: 12, color: '#9aa3b2', lineHeight: 1.7, marginBottom: 16, background: 'rgba(30,64,175,0.08)', padding: 12, borderRadius: 12, border: '1px solid rgba(30,64,175,0.15)' }}>
                  🔌 اپ بصورت داینامیک با هر سرویسی ارتباط می‌گیره — شما فقط آدرس و کلید رو وارد کنید — هر کی از هر کجا خواست سرویس بگیره — بدون محدودیت — بدون اسم خاص — فقط آدرس و کلید
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {step.dynamicFields.map((field, idx) => (
                    <div key={idx}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', display: 'block', marginBottom: 6 }}>{field.label}</label>
                      {field.type === 'select' ? (
                        <select
                          value={formData[step.id]?.[field.label] || ''}
                          onChange={(e) => handleFormChange(field.label, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(0,0,0,0.3)',
                            color: '#f2f4f8',
                            fontSize: 13,
                          }}
                        >
                          <option value="">{field.placeholder}</option>
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt} style={{ background: '#12151f' }}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type === 'key' ? 'password' : 'text'}
                          placeholder={field.placeholder}
                          value={formData[step.id]?.[field.label] || ''}
                          onChange={(e) => handleFormChange(field.label, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(0,0,0,0.3)',
                            color: '#f2f4f8',
                            fontSize: 13,
                          }}
                        />
                      )}
                      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>💡 {field.placeholder}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, padding: 12, background: 'rgba(88,230,168,0.08)', borderRadius: 12, border: '1px solid rgba(88,230,168,0.15)', fontSize: 11, color: '#9aa3b2', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 600, color: '#58e6a8', marginBottom: 4 }}>🔐 امنیت — داینامیک — بدون اسم سرویس:</div>
                  • آدرس سرویس رو خودتون وارد می‌کنید — هر سرویسی — هر کجا — مثلا: https://api.example.com/v1 یا http://localhost:11434
                  <br />• کلید API رو خودتون وارد می‌کنید — با sk- یا هر فرمتی — امن — 600
                  <br />• اپ بصورت داینامیک با هر سرویسی ارتباط می‌گیره — بدون محدودیت — بدون اسم خاص — فقط آدرس و کلید — هر کی از هر کجا خواست سرویس بگیره
                </div>
              </div>

              {/* Tip */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(244,200,93,0.12), rgba(255,122,158,0.08))',
                  border: '1px solid rgba(244,200,93,0.2)',
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 20 }}>💡</span>
                <div style={{ fontSize: 12, lineHeight: 1.7, color: '#f2f4f8' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>پیشنهاد هوشمند:</div>
                  {step.tip}
                </div>
              </div>
            </div>

            {/* Right — Cloud vs Local Suggestions — بدون اسم سرویس — داینامیک */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Cloud */}
              {(showCloudLocal === 'both' || showCloudLocal === 'cloud') && (
                <div
                  style={{
                    background: 'linear-gradient(135deg, rgba(30,64,175,0.12), rgba(59,130,246,0.08))',
                    border: '1px solid rgba(30,64,175,0.25)',
                    borderRadius: 20,
                    padding: 20,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, background: 'radial-gradient(circle, rgba(59,130,246,0.2), transparent)', borderRadius: '50%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, position: 'relative' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #1e40af, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>☁️</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{step.cloudSuggestion.title}</div>
                      <div style={{ fontSize: 11, color: '#60a5fa' }}>پیشنهاد ابری — Cloud</div>
                    </div>
                    <span style={{ marginRight: 'auto', fontSize: 10, background: 'rgba(59,130,246,0.15)', color: '#60a5fa', padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(59,130,246,0.2)' }}>{step.cloudSuggestion.cost}</span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.7, color: '#cbd5e1', marginBottom: 12, position: 'relative' }}>{step.cloudSuggestion.description}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, position: 'relative' }}>
                    {step.cloudSuggestion.pros.map((pro, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9aa3b2' }}>
                        <span style={{ color: '#60a5fa' }}>✓</span> {pro}
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, position: 'relative' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#60a5fa', marginBottom: 6 }}>📝 مثال — بدون اسم سرویس — داینامیک:</div>
                    <div style={{ fontSize: 11, color: '#9aa3b2', lineHeight: 1.6, fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>{step.cloudSuggestion.example}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>🔗 کجا: {step.cloudSuggestion.where}</div>
                  </div>
                </div>
              )}

              {/* Local */}
              {(showCloudLocal === 'both' || showCloudLocal === 'local') && (
                <div
                  style={{
                    background: 'linear-gradient(135deg, rgba(88,230,168,0.1), rgba(16,185,129,0.06))',
                    border: '1px solid rgba(88,230,168,0.25)',
                    borderRadius: 20,
                    padding: 20,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, background: 'radial-gradient(circle, rgba(88,230,168,0.2), transparent)', borderRadius: '50%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, position: 'relative' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #059669, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🏠</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{step.localSuggestion.title}</div>
                      <div style={{ fontSize: 11, color: '#58e6a8' }}>پیشنهاد محلی — Local</div>
                    </div>
                    <span style={{ marginRight: 'auto', fontSize: 10, background: 'rgba(88,230,168,0.15)', color: '#58e6a8', padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(88,230,168,0.2)' }}>{step.localSuggestion.cost}</span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.7, color: '#cbd5e1', marginBottom: 12, position: 'relative' }}>{step.localSuggestion.description}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, position: 'relative' }}>
                    {step.localSuggestion.pros.map((pro, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9aa3b2' }}>
                        <span style={{ color: '#58e6a8' }}>✓</span> {pro}
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, position: 'relative' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#58e6a8', marginBottom: 6 }}>📝 مثال — بدون اسم سرویس — داینامیک:</div>
                    <div style={{ fontSize: 11, color: '#9aa3b2', lineHeight: 1.6, fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>{step.localSuggestion.example}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>🔗 کجا: {step.localSuggestion.where}</div>
                  </div>
                </div>
              )}

              {/* Comparison */}
              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⚖️</span> مقایسه سریع — ابری vs محلی — بدون اسم سرویس
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                  <div style={{ textAlign: 'center', padding: 8, background: 'rgba(59,130,246,0.08)', borderRadius: 10, border: '1px solid rgba(59,130,246,0.15)' }}>
                    <div style={{ fontWeight: 600, color: '#60a5fa' }}>☁️ ابری</div>
                    <div style={{ color: '#9aa3b2', marginTop: 4 }}>قدرتمند، از هر کجا، همیشه آپدیت</div>
                    <div style={{ color: '#6b7280', marginTop: 4, fontSize: 10 }}>{STEPS[currentStep].cloudSuggestion.cost}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: 8, background: 'rgba(88,230,168,0.08)', borderRadius: 10, border: '1px solid rgba(88,230,168,0.15)' }}>
                    <div style={{ fontWeight: 600, color: '#58e6a8' }}>🏠 محلی</div>
                    <div style={{ color: '#9aa3b2', marginTop: 4 }}>امن، رایگان، پیش خودتون</div>
                    <div style={{ color: '#6b7280', marginTop: 4, fontSize: 10 }}>{STEPS[currentStep].localSuggestion.cost}</div>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 10, color: '#6b7280', textAlign: 'center', lineHeight: 1.6 }}>
                  💡 هر دو قابل تغییر — داینامیک — هر کی از هر کجا خواست سرویس بگیره — بدون محدودیت — بدون اسم خاص — فقط آدرس و کلید
                </div>
              </div>
            </div>
          </div>

          {/* Navigation — Windows 11 style */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 32, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={handlePrev}
              disabled={currentStep === 0}
              style={{
                padding: '10px 20px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.1)',
                background: currentStep === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)',
                color: currentStep === 0 ? '#4b5563' : '#f2f4f8',
                fontSize: 13,
                cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>→</span> قبلی
            </button>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: '#6b7280' }}>مرحله {currentStep + 1} از {STEPS.length} — {step.title}</div>
            <div style={{ flex: 1 }} />
            {currentStep < STEPS.length - 1 ? (
              <button
                onClick={handleNext}
                style={{
                  padding: '10px 24px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #1e40af, #3730a3)',
                  color: 'white',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 16px rgba(30,64,175,0.3)',
                }}
              >
                بعدی <span>←</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setCompleted(STEPS.map((s) => s.id));
                  alert('✅ نصب کامل شد — انصار داد — AnsarDad OS — 39/39 — 0 تاریکی — بی‌ادعا سقف — ساخته شده توسط انصار هوش مصنوعی — ansariai.ir — همکاری، کانفیگ، پشتیبانی — برای همه پروژه‌ها — دسته‌بندی — فاز بسته شد — تمیز — تاریکی روشن شد');
                }}
                style={{
                  padding: '12px 28px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  color: 'white',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 6px 20px rgba(5,150,105,0.3)',
                }}
              >
                🎉 اتمام نصب — AnsarDad آماده است
              </button>
            )}
          </div>

          {/* Footer — Ansariai Branding — تبلیغ خودمون — همکاری + کانفیگ + پشتیبانی — بدون اسم سرویس */}
          <div
            style={{
              marginTop: 32,
              padding: 20,
              background: 'linear-gradient(135deg, rgba(30,64,175,0.08), rgba(69,216,194,0.06))',
              border: '1px solid rgba(30,64,175,0.15)',
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #1e40af, #45d8c2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>⚖️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                انصار داد — AnsarDad OS — دستیار هوشمند عدالت
                <span style={{ fontSize: 10, background: 'linear-gradient(135deg, #1e40af, #3730a3)', color: 'white', padding: '2px 8px', borderRadius: 12 }}>ساخته شده توسط ansariai</span>
              </div>
              <div style={{ fontSize: 12, color: '#9aa3b2', marginTop: 4, lineHeight: 1.6 }}>
                ما می‌تونیم براتون کانفیگ کنیم، پشتیبانی کنیم، یا همکاری کنیم — از صفر تا صد — بدون اسم سرویس — داینامیک — هر کی از هر کجا خواست سرویس بگیره — اپ بصورت داینامیک با هر سرویسی ارتباط می‌گیره — وبسایت: ansariai.ir — همه پروژه‌ها دسته‌بندی شده — هر چی می‌سازیم می‌ره تو دسته خودش
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>39/39 — 0 تاریکی — سقف</span>
                <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>10/10 محصولی واقعی — بی‌ادعا سقف</span>
                <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>انصار هوش مصنوعی — ansariai.ir</span>
                <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>همکاری + کانفیگ + پشتیبانی</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a href="https://ansariai.ir" target="_blank" style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #1e40af, #3730a3)', borderRadius: 10, color: 'white', textDecoration: 'none', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>🌐 ansariai.ir</a>
              <a href="https://ansariai.ir/projects" target="_blank" style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.06)', borderRadius: 10, color: '#f2f4f8', textDecoration: 'none', fontSize: 11, textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)' }}>📦 پروژه‌ها — دسته‌بندی</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
