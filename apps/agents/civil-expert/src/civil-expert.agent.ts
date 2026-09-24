import { createExpertAgent } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { AGENT_ID, AGENT_VERSION, skills } from '../capabilities';
import type { AgentTask, AgentResult } from '@legal-platform/shared';

/**
 * Real Civil Expert — قراردادها و دعاوی مدنی
 * Provides actual legal analysis for contracts and civil claims under Iranian Civil Code.
 */

interface ContractClause {
  name: string;
  persianName: string;
  required: boolean;
  description: string;
  articleRef?: string;
}

const CONTRACT_CLAUSES: ContractClause[] = [
  { name: 'parties', persianName: 'طرفین قرارداد', required: true, description: 'مشخصات کامل طرفین', articleRef: 'ماده ۱۹۰ قانون مدنی' },
  { name: 'subject', persianName: 'موضوع قرارداد', required: true, description: 'موضوع معامله باید معلوم و معین باشد', articleRef: 'ماده ۲۱۶ قانون مدنی' },
  { name: 'price', persianName: 'ثمن/مبلغ', required: true, description: 'قیمت و نحوه پرداخت', articleRef: 'ماده ۳۳۸ قانون مدنی' },
  { name: 'duration', persianName: 'مدت قرارداد', required: false, description: 'مدت و تاریخ اجرا', articleRef: 'ماده ۲۵۱ قانون مدنی' },
  { name: 'obligations', persianName: 'تعهدات طرفین', required: true, description: 'تعهدات و مسئولیت‌ها', articleRef: 'ماده ۲۱۹ قانون مدنی' },
  { name: 'penalty', persianName: 'وجه التزام', required: false, description: 'خسارت تاخیر و عدم انجام تعهد', articleRef: 'ماده ۲۳۰ قانون مدنی' },
  { name: 'termination', persianName: 'شرایط فسخ', required: false, description: 'موارد فسخ و انفساخ', articleRef: 'ماده ۲۱۹ و ۲۶۴ قانون مدنی' },
  { name: 'dispute', persianName: 'حل اختلاف', required: false, description: 'مرجع حل اختلاف و داوری', articleRef: 'ماده ۴۵۴ قانون آیین دادرسی مدنی' },
  { name: 'warranty', persianName: 'تضمین و وثیقه', required: false, description: 'چک، سفته، رهن', articleRef: 'ماده ۶۸۴ قانون مدنی' },
];

const CIVIL_CLAIMS_TYPES: Record<string, { name: string; description: string; procedure: string; court: string }> = {
  'خسارت': { name: 'مطالبه خسارت', description: 'مطالبه خسارت ناشی از عدم انجام تعهد یا تقصیر', procedure: 'تقدیم دادخواست + ادله + کارشناسی', court: 'دادگاه حقوقی' },
  'الزام': { name: 'الزام به انجام تعهد', description: 'الزام متعهد به اجرای قرارداد', procedure: 'دادخواست الزام + مستندات قرارداد', court: 'دادگاه حقوقی' },
  'فسخ': { name: 'فسخ قرارداد', description: 'درخواست فسخ به دلیل تخلف یا خیار', procedure: 'اظهارنامه + دادخواست فسخ', court: 'دادگاه حقوقی' },
  'ابطال': { name: 'ابطال قرارداد', description: 'بطلان معامله به دلیل فقدان شرایط اساسی', procedure: 'دادخواست ابطال + دلایل بطلان', court: 'دادگاه حقوقی' },
  'خلع ید': { name: 'خلع ید', description: 'رفع تصرف غاصبانه از ملک', procedure: 'دادخواست خلع ید + سند مالکیت', court: 'دادگاه حقوقی' },
  'تصرف عدوانی': { name: 'رفع تصرف عدوانی', description: 'دعوای تصرف عدوانی حقوقی', procedure: 'دادخواست + شهادت شهود', court: 'دادگاه حقوقی' },
  'ارث': { name: 'انحصار وراثت و تقسیم ترکه', description: 'گواهی انحصار وراثت و تقسیم', procedure: 'درخواست انحصار وراثت + تقسیم ترکه', court: 'شورای حل اختلاف / دادگاه حقوقی' },
};

function analyzeContract(query: string): { clauses: ContractClause[]; missing: ContractClause[]; recommendations: string[] } {
  const lowerQuery = query.toLowerCase();
  const foundClauses: ContractClause[] = [];
  const missingClauses: ContractClause[] = [];

  // Simple heuristic: check if clause keywords exist in query
  const clauseKeywords: Record<string, string[]> = {
    parties: ['طرفین', 'خریدار', 'فروشنده', 'موجر', 'مستاجر', 'کارفرما', 'پیمانکار'],
    subject: ['موضوع', 'مورد معامله', 'مورد اجاره', 'خدمات', 'کالا'],
    price: ['مبلغ', 'قیمت', 'ثمن', 'اجاره بها', 'حق الزحمه'],
    duration: ['مدت', 'تاریخ', 'زمان', 'از تاریخ', 'تا تاریخ'],
    obligations: ['تعهد', 'وظیفه', 'مسئولیت', 'انجام', 'تحویل'],
    penalty: ['جریمه', 'خسارت', 'وجه التزام', 'تاخیر'],
    termination: ['فسخ', 'انفساخ', 'خاتمه', 'ابطال'],
    dispute: ['اختلاف', 'داوری', 'حل اختلاف', 'مرجع'],
    warranty: ['تضمین', 'چک', 'سفته', 'رهن', 'وثیقه', 'ضمانت'],
  };

  for (const clause of CONTRACT_CLAUSES) {
    const keywords = clauseKeywords[clause.name] || [];
    const found = keywords.some(kw => lowerQuery.includes(kw.toLowerCase()));
    if (found) {
      foundClauses.push(clause);
    } else if (clause.required) {
      missingClauses.push(clause);
    }
  }

  const recommendations: string[] = [];
  if (missingClauses.length > 0) {
    recommendations.push(`بندهای الزامی مفقود: ${missingClauses.map(c => c.persianName).join('، ')}`);
  }
  if (!lowerQuery.includes('امضا') && !lowerQuery.includes('اثر انگشت')) {
    recommendations.push('افزودن محل امضا و اثر انگشت طرفین');
  }
  if (!lowerQuery.includes('شاهد') && !lowerQuery.includes('گواه')) {
    recommendations.push('در نظر گرفتن شهود برای قراردادهای مهم');
  }
  recommendations.push('بررسی اهلیت طرفین و عدم وجود اکراه یا اشتباه (ماده ۱۹۰ قانون مدنی)');
  recommendations.push('ذکر تاریخ تنظیم و شماره قرارداد');

  return { clauses: foundClauses, missing: missingClauses, recommendations };
}

function analyzeCivilClaim(query: string): { type: string; info: Record<string, unknown> & { name?: string; court?: string }; steps: string[]; documents: string[] } | null {
  const lowerQuery = query.toLowerCase();

  for (const [keyword, info] of Object.entries(CIVIL_CLAIMS_TYPES)) {
    if (lowerQuery.includes(keyword)) {
      const steps = [
        `۱. تنظیم دادخواست ${info.name} مطابق ماده ۴۸ قانون آیین دادرسی مدنی`,
        `۲. تهیه مدارک: قرارداد، رسیدها، شهادت شهود`,
        `۳. تقدیم دادخواست به ${info.court}`,
        `۴. پرداخت هزینه دادرسی (طبق تعرفه)`,
        `۵. شرکت در جلسات دادرسی و ارائه ادله`,
        `۶. در صورت محکومیت، اجرای حکم از طریق اجرای احکام`,
      ];

      const documents = [
        'کپی کارت ملی و شناسنامه',
        'اصل و کپی قرارداد یا سند',
        'اظهارنامه (در صورت نیاز)',
        'رسیدها و مدارک پرداخت',
        'شهادت شهود (در صورت وجود)',
        'نظریه کارشناسی (در صورت نیاز)',
      ];

      return { type: keyword, info, steps, documents };
    }
  }

  return null;
}

async function civilExpertExecutor(task: AgentTask, routed: { skillId: string; score: number } | null): Promise<AgentResult> {
  const query = task.query || '';
  const skillId = routed?.skillId || 'civil:general';
  const personaName = 'کارشناس ارشد امور مدنی';

  let output = '';
  const citations: Array<{ text: string; sourceId: string; url?: string }> = [];
  let analysis: Record<string, unknown> = {};

  if (skillId === 'civil:contracts' || query.includes('قرارداد') || query.includes('اجاره') || query.includes('بیع')) {
    const contractAnalysis = analyzeContract(query);
    analysis = contractAnalysis;

    output = `🏛️ **تحلیل قرارداد — کارشناس ارشد امور مدنی**

**پرسش:** ${query}

**مهارت انتخاب‌شده:** قراردادها (${skillId}) — امتیاز ${routed?.score?.toFixed(2) || 'N/A'}

### بندهای شناسایی‌شده:
${contractAnalysis.clauses.map(c => `- ✅ ${c.persianName}: ${c.description} (${c.articleRef})`).join('\n') || '- هیچ بند مشخصی شناسایی نشد'}

### بندهای الزامی مفقود:
${contractAnalysis.missing.map(c => `- ❌ ${c.persianName}: ${c.description} — ${c.articleRef}`).join('\n') || '- همه بندهای الزامی موجود است'}

### توصیه‌های حقوقی:
${contractAnalysis.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}

### مواد قانونی مرتبط:
- ماده ۱۹۰ قانون مدنی: شرایط اساسی صحت معاملات (قصد، اهلیت، موضوع معین، مشروعیت جهت)
- ماده ۲۱۹ قانون مدنی: عقود لازم الاجرا هستند
- ماده ۲۲۱ قانون مدنی: مسئولیت متخلف از اجرای تعهد
- ماده ۲۳۰ قانون مدنی: وجه التزام

⚠️ **تذکر:** این تحلیل اولیه است و نیاز به بررسی وکیل دارد. قرارداد نهایی باید توسط وکیل تنظیم شود.
`;

    citations.push(
      { text: 'ماده ۱۹۰ قانون مدنی — شرایط اساسی صحت معامله', sourceId: 'civil-code-190' },
      { text: 'ماده ۲۱۹ قانون مدنی — لزوم اجرای عقود', sourceId: 'civil-code-219' },
      { text: 'ماده ۲۳۰ قانون مدنی — وجه التزام', sourceId: 'civil-code-230' },
    );
  } else if (skillId.includes('property') || query.includes('ملک') || query.includes('سند')) {
    output = `🏠 **تحلیل امور ملکی — کارشناس ارشد امور مدنی**

**پرسش:** ${query}

**مهارت:** املاک و اسناد مالکیت — امتیاز ${routed?.score?.toFixed(2) || 'N/A'}

### نکات حقوقی ملکی:
۱. **بررسی سند:** اطمینان از رسمی بودن سند و عدم وجود معارض (ماده ۲۲ قانون ثبت)
۲. **استعلامات:** استعلام از اداره ثبت، شهرداری، دارایی، تامین اجتماعی
۳. **بازداشت و رهن:** بررسی عدم بازداشت ملک و عدم وجود رهن (ماده ۷۹۳ قانون مدنی)
۴. **کاربری:** تطابق کاربری ملک با هدف خریدار
۵. **پایان کار و صورت مجلس تفکیکی:** برای آپارتمان‌ها الزامی است

### دعاوی شایع ملکی:
- خلع ید (ماده ۳۰۸ قانون مدنی)
- تصرف عدوانی (ماده ۱۵۸ قانون آیین دادرسی مدنی)
- الزام به تنظیم سند رسمی (ماده ۲۲۰ قانون مدنی)

### مدارک لازم:
- سند مالکیت، بنچاق، استعلامات، پایان کار، مفاصا حساب

⚠️ نیاز به بررسی حضوری و کارشناسی رسمی دادگستری دارد.
`;
    citations.push(
      { text: 'ماده ۲۲ قانون ثبت — اعتبار اسناد رسمی', sourceId: 'registration-law-22' },
      { text: 'ماده ۳۰۸ قانون مدنی — غصب', sourceId: 'civil-code-308' },
    );
  } else if (skillId.includes('tort') || query.includes('خسارت') || query.includes('مسئولیت')) {
    const claimAnalysis = analyzeCivilClaim(query);

    output = `⚖️ **تحلیل مسئولیت مدنی و خسارت**

**پرسش:** ${query}

**مهارت:** مسئولیت مدنی — امتیاز ${routed?.score?.toFixed(2) || 'N/A'}

### ارکان مسئولیت مدنی (ماده ۱ قانون مسئولیت مدنی):
۱. **وجود ضرر:** خسارت مادی یا معنوی وارد شده
۲. **فعل زیانبار:** عمل یا ترک فعل خوانده
۳. **رابطه سببیت:** رابطه علیت بین فعل و ضرر

### انواع خسارت قابل مطالبه:
- خسارت مادی: از دست رفتن مال، عدم النفع مسلم
- خسارت معنوی: لطمه به حیثیت، درد و رنج (ماده ۱ و ۲ قانون مسئولیت مدنی)
- هزینه دادرسی و حق الوکاله

${claimAnalysis ? `
### تحلیل دعوای ${claimAnalysis.info.name}:
**توضیح:** ${claimAnalysis.info.description}
**مرجع صالح:** ${claimAnalysis.info.court}

**مراحل:**
${claimAnalysis.steps.join('\n')}

**مدارک لازم:**
${claimAnalysis.documents.map(d => `- ${d}`).join('\n')}
` : ''}

### مستندات قانونی:
- ماده ۱ قانون مسئولیت مدنی
- ماده ۳۲۸ قانون مدنی: هر کس مال غیر را تلف کند ضامن است
- ماده ۳۳۱ قانون مدنی: هر کس سبب تلف مال غیر شود ضامن است

⚠️ اثبات تقصیر و رابطه سببیت بر عهده خواهان است.
`;
    citations.push(
      { text: 'ماده ۱ قانون مسئولیت مدنی', sourceId: 'liability-law-1' },
      { text: 'ماده ۳۲۸ قانون مدنی — اتلاف', sourceId: 'civil-code-328' },
    );
  } else if (skillId.includes('inheritance') || query.includes('ارث') || query.includes('میراث')) {
    output = `📜 **تحلیل امور ارث و وصیت**

**پرسش:** ${query}

**مهارت:** ارث و وصیت — امتیاز ${routed?.score?.toFixed(2) || 'N/A'}

### طبقات ارث (ماده ۸۶۲ قانون مدنی):
- **طبقه اول:** پدر، مادر، اولاد و اولاد اولاد
- **طبقه دوم:** اجداد، برادر، خواهر و اولاد آنها
- **طبقه سوم:** اعمام، عمات، اخوال، خالات و اولاد آنها

### سهم الارث:
- زوجه: ۱/۸ در صورت وجود فرزند، ۱/۴ بدون فرزند (ماده ۹۴۶)
- زوج: ۱/۴ با فرزند، ۱/۲ بدون فرزند (ماده ۹۴۶)
- دختر: نصف پسر (ماده ۹۰۷)
- مادر: ۱/۶ با وجود فرزند یا برادر (ماده ۹۰۶)

### وصیت:
- تا ثلث ترکه نافذ است (ماده ۸۴۳)
- بیش از ثلث نیاز به اجازه ورثه دارد (ماده ۸۴۴)

### مراحل انحصار وراثت:
۱. درخواست گواهی انحصار وراثت از شورای حل اختلاف
۲. نشر آگهی (۱ ماه)
۳. صدور گواهی
۴. تقسیم ترکه یا فروش و تقسیم ثمن

⚠️ محاسبه دقیق سهم الارث نیاز به اطلاعات کامل وراث دارد.
`;
    citations.push(
      { text: 'ماده ۸۶۲ قانون مدنی — طبقات ارث', sourceId: 'civil-code-862' },
      { text: 'ماده ۸۴۳ قانون مدنی — وصیت تا ثلث', sourceId: 'civil-code-843' },
    );
  } else {
    output = `🏛️ **کارشناس ارشد امور مدنی — پاسخ عمومی**

**پرسش:** ${query}

**مهارت انتخاب‌شده:** ${skillId} — امتیاز ${routed?.score?.toFixed(2) || 'N/A'}

این پرسش در حوزه حقوق مدنی قرار دارد. برای ارائه تحلیل دقیق‌تر، لطفا جزئیات بیشتری ارائه دهید:

- نوع قرارداد یا دعوا
- طرفین و موضوع
- تاریخ و محل وقوع
- مدارک موجود

### حوزه‌های تخصصی این ایجنت:
- قراردادها: تنظیم، فسخ، ابطال، تعهدات (مواد ۱۸۳ تا ۳۰۰ قانون مدنی)
- املاک: مالکیت، رهن، سرقفلی، انتقال
- مسئولیت مدنی: خسارت، تقصیر، جبران
- ارث و وصیت: انحصار وراثت، تقسیم ترکه

⚠️ این پاسخ جنبه اطلاع‌رسانی دارد و مشاوره حقوقی نهایی محسوب نمی‌شود.

---
*${personaName} — ${skillId}*
`;
  }

  // Ensure persona name appears in output
  if (!output.includes(personaName)) {
    output += `\n\n${personaName}`;
  }

  return {
    ok: true,
    output,
    citations,
    meta: {
      grounded: citations.length > 0,
      requiresReview: true,
      skillId,
      score: routed?.score || 0,
      analysis,
      field: 'civil',
      version: AGENT_VERSION,
    },
  };
}

export const civilExpert = createExpertAgent({
  agentId: AGENT_ID,
  version: AGENT_VERSION,
  field: LegalField.CIVIL,
  skills,
  subspecialties: ['contracts', 'property', 'tort', 'inheritance'],
  persona: {
    displayName: 'کارشناس ارشد امور مدنی',
    motto: 'قانون مدنی را ماده‌به‌ماده پاس می‌دارد؛ هر بند قرارداد یک مسئولیت است.',
  },
  customExecute: civilExpertExecutor,
});
