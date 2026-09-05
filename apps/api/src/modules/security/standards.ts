/**
 * Standards catalog (P6-S3) — the Security Guardian's yardstick.
 *
 * Every check cites REAL, lookup-able references (OWASP API Security Top 10
 * 2023, OWASP ASVS 4.0 chapters, CWE ids, NIST CSF 2.0 functions) so the
 * report is audit-usable, not vibes. A check NEVER claims a standard that it
 * does not actually probe — the honesty invariants of ADR-016/017/018 apply
 * to security posture too (ADR-021).
 *
 * `weight`s are deliberately uneven and sum to 10.0 so the posture score is
 * literally "x out of 10" — the metric the owner asked for.
 */

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface StandardCheckDef {
  /** stable id, kebab-case; API + reports key on this */
  readonly id: string;
  /** standard references, e.g. 'OWASP-API8:2023', 'ASVS-4.0-V14.4', 'CWE-798' */
  readonly standardRefs: readonly string[];
  readonly titleEn: string;
  readonly titleFa: string;
  readonly severity: CheckSeverity;
  /** share of the 10-point posture score */
  readonly weight: number;
}

export const SECURITY_STANDARDS_VERSION = '2026.09-owaspapi2023-asvs4-nistcsf2';

export const STANDARDS: readonly StandardCheckDef[] = [
  {
    id: 'transport.headers',
    standardRefs: ['OWASP-API8:2023', 'ASVS-4.0-V14.4'],
    titleEn: 'Security headers on every API response',
    titleFa: 'هدرهای امنیتی روی همه پاسخ‌ها',
    severity: 'high',
    weight: 1.2,
  },
  {
    id: 'transport.hsts',
    standardRefs: ['OWASP-API8:2023', 'ASVS-4.0-V9.1', 'NIST-CSF2-PR'],
    titleEn: 'HSTS in production transport',
    titleFa: 'فعال بودن HSTS در محیط عملیاتی',
    severity: 'high',
    weight: 0.8,
  },
  {
    id: 'cors.allowlist',
    standardRefs: ['OWASP-API8:2023', 'ASVS-4.0-V14.5'],
    titleEn: 'CORS allow-list (no wildcard credentials)',
    titleFa: 'فهرست مجاز CORS بدون عبور گسترده',
    severity: 'critical',
    weight: 1.0,
  },
  {
    id: 'auth.otp-throttle',
    standardRefs: ['OWASP-API2:2023', 'ASVS-4.0-V2.2', 'CWE-307'],
    titleEn: 'OTP request/verify throttling + lockout',
    titleFa: 'محدودسازی و قفل‌لین تلاش‌های OTP',
    severity: 'critical',
    weight: 1.4,
  },
  {
    id: 'rate-limit.global',
    standardRefs: ['OWASP-API4:2023', 'ASVS-4.0-V11.1'],
    titleEn: 'Global per-IP rate floor before controller logic',
    titleFa: 'سقف نرخ کلی به‌ازای IP پیش از منطق کنترلر',
    severity: 'high',
    weight: 1.0,
  },
  {
    id: 'secrets.env-hygiene',
    standardRefs: ['CWE-798', 'OWASP-API8:2023', 'ASVS-4.0-V2.10'],
    titleEn: 'No placeholder/default secrets in runtime env',
    titleFa: 'نبود Secret پیش‌فرض در محیط اجرا',
    severity: 'critical',
    weight: 1.4,
  },
  {
    id: 'machine-tokens.hygiene',
    standardRefs: ['OWASP-API2:2023', 'NIST-CSF2-PR.AA'],
    titleEn: 'Machine tokens: closed scopes, bound expiry, prompt revocation',
    titleFa: 'توکن‌های ماشین: اسکوپ بسته، انقضای محدود، لغو فوری',
    severity: 'high',
    weight: 0.8,
  },
  {
    id: 'payload.bounds',
    standardRefs: ['OWASP-API4:2023', 'ASVS-4.0-V13.2', 'CWE-770'],
    titleEn: 'Bounded JSON bodies + honest 400/413 envelope',
    titleFa: 'بدنه JSON محدود + پاسخ صادقانه ۴۰۰/۴۱۳',
    severity: 'medium',
    weight: 0.8,
  },
  {
    id: 'workers.liveness',
    standardRefs: ['NIST-CSF2-DE.CM', 'SPEC-§2-failure-domains'],
    titleEn: 'Python workers reachable (intelligence survives cloud loss)',
    titleFa: 'در دسترس بودن ورکرهای پایتونی (ماندگاری هوشمندی بدون کلاد)',
    severity: 'medium',
    weight: 0.8,
  },
  {
    id: 'standards.freshness',
    standardRefs: ['OWASP-API9:2023', 'NIST-CSF2-GV'],
    titleEn: 'Security posture re-checked within cadence',
    titleFa: 'بازبینی دوره‌ای وضعیت امنیت در بازه مجاز',
    severity: 'medium',
    weight: 0.8,
  },
] as const;

/** Guard against weight drift — tests pin Σ to exactly 10. */
export const TOTAL_WEIGHT = STANDARDS.reduce((sum, c) => sum + c.weight, 0);
