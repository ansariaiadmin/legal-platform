/**
 * Conversational configuration intents (ADR-014). The owner TALKS to the
 * Leader — "به مدل محلی وصل شو آدرس http://gpu-box:8080" — and the Leader
 * proposes a concrete config action the owner then confirms. Parsing is
 * DETERMINISTIC PERSIAN REGEXES FIRST (SPEC invariant); no LLM sits between
 * the office and its own safety levers.
 */

export type ConfigProposalKind = 'connect_local' | 'connect_cloud' | 'set_preset' | 'set_locale' | 'set_country';

export interface ConfigProposal {
  kind: ConfigProposalKind;
  params: { baseUrl?: string; model?: string; apiKey?: string; preset?: string; locale?: 'fa' | 'en'; country?: string; currency?: string; timezone?: string };
  /** Persian human-readback shown in chat before applying */
  summaryFa: string;
}

const URL_RE = /https?:\/\/[^\s"'«»]+/i;
const LOCAL_RE = /(?:مدل|magh[z|]?\s*محلی|محلی)/;
const CLOUD_RE = /(?:ابری|cloud|کلید\s*ا\s*پی\s*آی|api\s*key|کلید)/i;
const CONNECT_RE = /(وصل|اتصال|تنظیم|تغییر|ست کن|بزن|قرار بده)/;
const PRESET_RE = /(اسپارتان|spartan|کانسل|کائونسل|counsel|سناتور|سِناتور|senator)/i;

const CONFIRM_RE = /^(بله|تایید|تأیید|انجام بده|اجرا کن|اوکی|ok|yes)[.! ،,]*$/i;

const TIER_FA: Record<string, string> = {
  spartan: 'اسپارتان',
  counsel: 'کانسل',
  senator: 'سناتور',
};

/** Parse a raw message; null when the turn is an ordinary legal question. */
export function parseConfigIntent(text: string): ConfigProposal | null {
  const t = text.trim();

  // P7-T5: locale — فارسی AND english, so a foreign operator can say
  // 'set platform to English' OR 'پلتفرم را با انگلیسی ست کن'.
  const localeEn = /(set|switch|change|use)?\s*(platform|ui|app|زبان|interface)?\s*(to|به|را با|با)\s*(english|انگلیسی|انگلیس)/i.test(t)
    || /زبان\s*(پلتفرم|داشبورد|رابط)?\s*(را)?\s*(به|با)\s*(انگلیسی)/.test(t);
  const localeFa = /(set|switch|change)\s*(platform|ui|app)\s*(to)\s*(persian|farsi|fa\b)/i.test(t)
    || /زبان\s*(پلتفرم|داشبورد|رابط)?\s*(را)?\s*(به|با)\s*(فارسی)/.test(t)
    || /انگلیسی.*(برگرد|فارسی کن)|(برگردان|قبلی کن).*فارسی/.test(t);
  if (localeEn && !localeFa) {
    return {
      kind: 'set_locale',
      params: { locale: 'en' },
      summaryFa: 'زبان پیش‌فرض پلتفرم «English» شود: رابط چپ‌چین می‌گردد و دیکشنری انگلیسی بار می‌شود؛ دادهٔ موکل هیچ تغییری نمی‌کند.',
    };
  }
  if (localeFa) {
    return {
      kind: 'set_locale',
      params: { locale: 'fa' },
      summaryFa: 'زبان پیش‌فرض پلتفرم «فارسی» شود: راست‌چین، دیکشنری فارسی، بدون دست‌خوردن داده.',
    };
  }

  // P7-T5: country profile — "برای آلمان کانفیگ کن" / "configure for Germany"
  const countryHit =
    t.match(/برای\s+([آ-یA-Za-z\s]+?)\s+کانفیگ\s*کن/) ||
    t.match(/configure\s+for\s+([A-Za-z\s]+)/i);
  if (countryHit) {
    const country = countryHit[1].trim();
    return {
      kind: 'set_country',
      params: { country },
      summaryFa: `پروفایل استقرار برای «${country}» آماده شود: برچسب کشور/نظام حقوقی قابل بازبینی است؛ قوانین داخلی خودتان نهایی می‌شود.`,
    };
  }

  const presetHit = t.match(PRESET_RE);
  if (presetHit && /(تیر|پلن|پیش‌تنظیم|پکیج|پیکربندی|حالت|preset|tier|فعال)/i.test(t)) {
    const normalized = presetHit[1].toLowerCase();
    const preset =
      normalized === 'spartan' || normalized === 'اسپارتان'
        ? 'spartan'
        : normalized === 'senator' || normalized === 'سناتور' || normalized === 'سِناتور'
          ? 'senator'
          : 'counsel';
    return {
      kind: 'set_preset',
      params: { preset },
      summaryFa: `تیر «${TIER_FA[preset]}» فعال شود — سیاست استنتاج و ترجیح مدل‌ها طبق آن تنظیم می‌شود.`,
    };
  }

  const urlHit = t.match(URL_RE);
  if (urlHit && LOCAL_RE.test(t) && CONNECT_RE.test(t)) {
    const modelHit = t.match(/مدل[:\s]+([A-Za-z0-9._:\-/]+)/);
    return {
      kind: 'connect_local',
      params: { baseUrl: urlHit[0], model: modelHit?.[1] },
      summaryFa: `مغز محلی به «${urlHit[0]}»${modelHit ? ` با مدل «${modelHit[1]}»` : ''} وصل شود؛ داده‌ی موکل هرگز از دفتر خارج نمی‌شود.`,
    };
  }

  // cloud key: a sk- style token or any long bare token after کلید
  if (CLOUD_RE.test(t) && CONNECT_RE.test(t)) {
    const keyHit =
      t.match(/\b(sk-[A-Za-z0-9_\-]{8,}|sk_[A-Za-z0-9_\-]{8,}|[A-Za-z0-9_\-]{24,})\b/) ??
      t.match(/کلید[^\n]*?[:=]\s*(\S+)/);
    if (keyHit) {
      const baseUrl = urlHit?.[0];
      return {
        kind: 'connect_cloud',
        params: { apiKey: keyHit[1] ?? keyHit[0], baseUrl },
        summaryFa: `کلید ابری (••••${(keyHit[1] ?? keyHit[0]).slice(-4)}) تنظیم شود${baseUrl ? ` با درگاه «${baseUrl}»` : ''}؛ وظایف confidential همچنان محلی می‌مانند.`,
      };
    }
  }
  return null;
}

export function isConfigConfirmation(text: string): boolean {
  return CONFIRM_RE.test(text.trim());
}
