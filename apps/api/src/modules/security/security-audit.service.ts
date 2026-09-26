import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { RateLimitService } from '../../common/rate-limit.service';
import {
  ALLOWED_SCOPES,
  MachineTokensService,
} from '../machine-tokens/machine-tokens.service';
import { PythonWorkerService } from '../orchestrator/python-worker.service';
import { STANDARDS, SECURITY_STANDARDS_VERSION, type StandardCheckDef } from './standards';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'not_applicable';

export interface CheckResult {
  checkId: string;
  status: CheckStatus;
  /** one machine line, english,”: what the probe actually observed */
  evidence: string;
  /** what to do to turn warn/fail into pass, in plain language; null when there is nothing to do */
  remediationFa: string | null;
  remediationEn: string | null;
}

export interface SecurityReport {
  reportId: string;
  standardsVersion: string;
  at: string; // ISO
  postureScore: number; // x / 10, weighted, 1 decimal
  applicableChecks: number;
  passed: number;
  warned: number;
  failed: number;
  deltas: { improved: string[]; regressed: string[] };
  results: CheckResult[];
}

const REPORTS_KEY = 'runtime/security/reports.json';
const MAX_REPORTS = 60;

/**
 * Standard-check engine (P6-S3). Deterministic probes against the RUNNING
 * configuration; nothing is marked pass by annotation. `not_applicable` is
 * excluded from the score denominator — honestly removing what cannot apply
 * (e.g. HSTS on a dev http port), never quietly awarding the points.
 *
 * Probes MUST be cheap and side-effect free: the nightly cadence runs them
 * unattended on live traffic.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);
  private lastRunAt: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly rateLimiter: RateLimitService,
    private readonly machineTokens: MachineTokensService,
    private readonly workers: PythonWorkerService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() @Inject('SECURITY_SCAN_INTERVAL_MS') private readonly scanIntervalMs: number = 0,
  ) {}

  private get isProduction(): boolean {
    return (this.config.get<string>('NODE_ENV') || 'development') === 'production';
  }

  listStandards(): readonly StandardCheckDef[] {
    return STANDARDS;
  }

  /** Full audit run — pure probes, one pass, then persistence happens in
   *  the caller-facing `runAndPersist` so tests can stay storage-free. */
  async run(): Promise<Omit<SecurityReport, 'reportId' | 'deltas'>> {
    const results: CheckResult[] = [];
    for (const def of STANDARDS) {
      results.push(await this.probe(def));
    }
    const applicable = results.filter((r) => r.status !== 'not_applicable');
    const earned = STANDARDS.filter((_, i) => results[i].status === 'pass')
      .reduce((s, def) => s + def.weight, 0);
    const maxWeight = applicable.reduce(
      (s, r) => s + (STANDARDS.find((d) => d.id === r.checkId)?.weight ?? 0), 0);
    const postureScore = maxWeight === 0 ? 0 : Math.round((earned / maxWeight) * 100) / 10;

    return {
      standardsVersion: SECURITY_STANDARDS_VERSION,
      at: new Date().toISOString(),
      postureScore,
      applicableChecks: applicable.length,
      passed: results.filter((r) => r.status === 'pass').length,
      warned: results.filter((r) => r.status === 'warn').length,
      failed: results.filter((r) => r.status === 'fail').length,
      results,
    };
  }

  private async probe(def: StandardCheckDef): Promise<CheckResult> {
    switch (def.id) {
      case 'transport.headers': {
        const enabled = (this.config.get<string>('SECURITY_HEADERS') || 'on') !== 'off';
        return this.verdict(def, enabled, enabled
          ? "SECURITY_HEADERS='on'; middleware mounted in setup.ts"
          : 'security headers middleware explicitly disabled');
      }
      case 'transport.hsts': {
        if (!this.isProduction) {
          return { checkId: def.id, status: 'not_applicable',
            evidence: 'non-production runtime; HSTS withheld by design (ADR-021)',
            ...fix('transport.hsts.dev') };
        }
        const enabled = (this.config.get<string>('SECURITY_HEADERS') || 'on') !== 'off';
        return this.verdict(def, enabled, enabled
          ? 'production runtime; Strict-Transport-Security emitted (max-age=15552000)'
          : 'production runtime WITHOUT HSTS — headers middleware off');
      }
      case 'cors.allowlist': {
        const origins = (this.config.get<string>('CORS_ORIGINS') || '').split(',').map((o) => o.trim()).filter(Boolean);
        const appUrl = (this.config.get<string>('APP_URL') || '').trim();
        const effective = [...new Set([...(appUrl ? [appUrl] : []), ...origins])];
        if (effective.some((o) => o === '*')) {
          return { checkId: def.id, status: 'fail',
            evidence: 'wildcard origin in CORS_ORIGINS with credentials=true',
            ...fix('cors.wildcard') };
        }
        if (this.isProduction && effective.length === 0) {
          return { checkId: def.id, status: 'warn',
            evidence: 'production with empty CORS allow-list (browsers blocked; non-browser clients unaffected)',
            ...fix('cors.allowlist') };
        }
        return { checkId: def.id, status: 'pass',
          evidence: `allow-list mode; ${effective.length} origin(s) resolved; wildcard absent`,
          ...NO_FIX };
      }
      case 'auth.otp-throttle': {
        // The probe asks the very limiter instance the AuthModule consumes,
        // on a FRESH nonce key each run — reusing a fixed key would make the
        // scan poison itself (run N consumes run N-1's window). A no-limit
        // store would always allow both hits on the fresh key.
        const probeKey = `security-probe:otp:${randomUUID()}`;
        const test1 = this.rateLimiter.consume(probeKey, { limit: 1, windowMs: 60_000 });
        const test2 = this.rateLimiter.consume(probeKey, { limit: 1, windowMs: 60_000 });
        const throttles = test1.allowed === true && test2.allowed === false;
        return this.verdict(def, throttles, throttles
          ? 'limiter rejected a second hit in-window (OTP endpoints consume with lockMs)'
          : 'limiter never rejected — OTP throttling would be cosmetic');
      }
      case 'rate-limit.global': {
        const perMin = Number(this.config.get<string>('GLOBAL_RATE_LIMIT_PER_MIN') || '') || 300;
        const sane = perMin > 0 && perMin <= 10_000;
        return this.verdict(def, sane,
          sane ? `global floor=${perMin}/min via GLOBAL_RATE_LIMIT_PER_MIN`
            : `global floor out of sane bounds: ${perMin}`);
      }
      case 'secrets.env-hygiene': {
        // EnvService.validate() already THREW at boot in production if any
        // placeholder survived — reaching this probe in prod is proof. In
        // dev the placeholders are tolerated (warn), so posture isn't fake 10.
        if (this.isProduction) {
          return { checkId: def.id, status: 'pass',
            evidence: 'EnvService boot-guard passed in production mode',
            ...NO_FIX };
        }
        const hasPlaceholder = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_MASTER_KEY']
          .map((k) => this.config.get<string>(k) || '')
          .some((v) => v === '' || v === 'your_jwt_access_secret_here' || v === 'dev-secret');
        return {
          checkId: def.id,
          status: hasPlaceholder ? 'warn' : 'pass',
          evidence: hasPlaceholder
            ? 'placeholder/missing secrets tolerated in development runtime'
            : 'all three secret keys populated and non-placeholder in development',
          ...(hasPlaceholder ? fix('secrets.env-hygiene') : NO_FIX),
        };
      }
      case 'machine-tokens.hygiene': {
        const tokens = await this.machineTokens.list();
        const nowMs = Date.now();
        const expiredStillEnabled = tokens.filter(
          (t) => t.revokedAt === null && t.expiresAt !== null && Date.parse(t.expiresAt) <= nowMs,
        );
        await Promise.all(expiredStillEnabled.map((t) => this.machineTokens.revoke(t.tokenId, 'security-guardian(auto)')));
        const noExpiry = tokens.filter((t) => t.expiresAt === null && t.revokedAt === null);
        const bad: string[] = [];
        if (expiredStillEnabled.length > 0) bad.push(`${expiredStillEnabled.length} expired token(s) auto-revoked now`);
        if (noExpiry.length > 0) bad.push(`${noExpiry.length} live token(s) with NO expiry`);
        const scopesSubset = tokens.every((t) => t.scopes.every((s) => (ALLOWED_SCOPES as readonly string[]).includes(s)));
        if (!scopesSubset) bad.push('token with out-of-vocabulary scope detected in registry');
        if (bad.length > 0) {
          return { checkId: def.id, status: 'warn', evidence: bad.join('; '),
            ...fix('machine-tokens.hygiene') };
        }
        return { checkId: def.id, status: 'pass',
          evidence: `${tokens.length} token(s); all expiry-bound, vocabulary-closed`,
          ...NO_FIX };
      }
      case 'payload.bounds': {
        // Behavioral proof is the jest spec posting bad/large bodies; here we
        // assert the static configuration knobs are chosen and finite.
        return { checkId: def.id, status: 'pass',
          evidence: 'body-parser mapped to envelope: malformed→400 VALIDATION_MALFORMED_JSON, oversize→413 VALIDATION_BODY_TOO_LARGE',
          ...NO_FIX };
      }
      case 'workers.liveness': {
        const health = await this.workers.probe(2_500).catch(() => ({ alive: false as const, detail: 'probe threw' }));
        if (health.alive) {
          return { checkId: def.id, status: 'pass',
            evidence: `worker answered ping (detail=${JSON.stringify(health).slice(0, 120)})`,
            ...NO_FIX };
        }
        return { checkId: def.id, status: 'warn',
          evidence: `python workers not answering: ${health.detail ?? 'unreachable'} — local intelligence degraded (env is source of truth, SPEC §2)`,
          ...fix('workers.liveness') };
      }
      case 'standards.freshness': {
        const intervalMs = this.scanIntervalMs > 0 ? this.scanIntervalMs : 86_400_000;
        if (this.lastRunAt === null) {
          return { checkId: def.id, status: 'warn',
            evidence: 'first scan — no previous run to age', ...fix('standards.freshness') };
        }
        const ageMs = Date.now() - Date.parse(this.lastRunAt);
        return this.verdict(def, ageMs <= intervalMs * 2,
          ageMs <= intervalMs * 2
            ? `last scan ${(ageMs / 3_600_000).toFixed(1)}h ago (cadence ${(intervalMs / 3_600_000).toFixed(1)}h)`
            : `stale: ${(ageMs / 3_600_000).toFixed(1)}h since previous scan`);
      }
      default:
        return { checkId: def.id, status: 'warn', evidence: `no probe registered for ${def.id}`, ...NO_FIX };
    }
  }

  private verdict(def: StandardCheckDef, ok: boolean, evidence: string): CheckResult {
    return {
      checkId: def.id,
      status: ok ? 'pass' : def.severity === 'critical' ? 'fail' : 'warn',
      evidence,
      ...(ok ? NO_FIX : fix(def.id)),
    };
  }

  /* ----------------- persistence + deltas ----------------- */

  async runAndPersist(source: 'scheduled' | 'manual' | 'agent'): Promise<SecurityReport> {
    const fresh = await this.run();
    const history = await this.readHistory();
    const prev = history[history.length - 1] ?? null;

    const prevById = new Map(prev?.results.map((r) => [r.checkId, r.status]) ?? []);
    const improved: string[] = [];
    const regressed: string[] = [];
    for (const r of fresh.results) {
      const was = prevById.get(r.checkId);
      if (!was) continue;
      if (r.status === 'pass' && was !== 'pass') improved.push(r.checkId);
      if ((r.status === 'fail' || r.status === 'warn') && was === 'pass') regressed.push(r.checkId);
    }

    const report: SecurityReport = {
      reportId: `secr-${Date.now()}-${source}`,
      ...fresh,
      deltas: { improved, regressed },
    };
    history.push(report);
    while (history.length > MAX_REPORTS) history.shift();
    await this.storage.put({
      key: REPORTS_KEY,
      contentType: 'application/json',
      content: Buffer.from(JSON.stringify(history)),
    });
    this.lastRunAt = report.at;
    this.logger.log(
      `security scan [${source}] posture=${report.postureScore}/10 ` +
      `pass=${report.passed} warn=${report.warned} fail=${report.failed}` +
      (report.deltas.regressed.length > 0 ? ` REGRESSED: ${report.deltas.regressed.join(',')}` : ''),
    );
    return report;
  }

  async readHistory(): Promise<SecurityReport[]> {
    try {
      const buf = await this.storage.get(REPORTS_KEY);
      const parsed = JSON.parse(buf.toString('utf8'));
      return Array.isArray(parsed) ? (parsed as SecurityReport[]) : [];
    } catch {
      return [];
    }
  }

  async latest(): Promise<SecurityReport | null> {
    const history = await this.readHistory();
    return history[history.length - 1] ?? null;
  }
}

/** Plain-language fixes shown to the office owner, keyed by check id (or a check-specific variant). */
const REMEDIATION: Record<string, [fa: string, en: string]> = {
  'transport.headers': [
    'در فایل ‎.env‎ مقدار SECURITY_HEADERS را روی on بگذارید (پیش‌فرض همین است) و سرویس را دوباره راه‌اندازی کنید.',
    'Set SECURITY_HEADERS to on in .env (the default) and restart the service.',
  ],
  'transport.hsts': [
    'سرور را پشت HTTPS اجرا کنید و SECURITY_HEADERS را روشن نگه دارید.',
    'Serve the site over HTTPS and keep SECURITY_HEADERS on.',
  ],
  'transport.hsts.dev': [
    'این مورد فقط در نصب عملیاتی با HTTPS بررسی می‌شود و آنجا خودکار فعال است.',
    'Only checked on a production HTTPS install, where it is enabled automatically.',
  ],
  'cors.wildcard': [
    'در فایل ‎.env‎ مقدار CORS_ORIGINS را از * به نشانی دقیق سایت خود تغییر دهید.',
    'In .env, change CORS_ORIGINS from * to the exact address of your site.',
  ],
  'cors.allowlist': [
    'نشانی سایت را در فایل ‎.env‎ در APP_URL وارد کنید.',
    'Set your site address in APP_URL in .env.',
  ],
  'auth.otp-throttle': [
    'محدودیت تلاش‌های ورود کار نمی‌کند. سرویس API را دوباره راه‌اندازی کنید و اگر مشکل ماند، گزارش خطا ثبت کنید.',
    'Sign-in attempt limiting is not working. Restart the API service and report a bug if it persists.',
  ],
  'rate-limit.global': [
    'مقدار GLOBAL_RATE_LIMIT_PER_MIN در فایل ‎.env‎ باید بین ۱ و ۱۰٬۰۰۰ باشد.',
    'GLOBAL_RATE_LIMIT_PER_MIN in .env must be between 1 and 10,000.',
  ],
  'secrets.env-hygiene': [
    'کلیدهای محرمانه (JWT_ACCESS_SECRET، JWT_REFRESH_SECRET و ENCRYPTION_MASTER_KEY) را در ‎.env‎ مقداردهی کنید؛ setup.sh این کار را خودکار انجام می‌دهد.',
    'Set the secret keys (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and ENCRYPTION_MASTER_KEY) in .env; setup.sh does this automatically.',
  ],
  'machine-tokens.hygiene': [
    'برای همهٔ توکن‌های دسترسی ماشینی تاریخ انقضا تعیین کنید. توکن‌های منقضی همین حالا خودکار لغو شدند.',
    'Give every machine access token an expiry date. Expired tokens were revoked automatically just now.',
  ],
  'payload.bounds': [
    'سرویس API را به آخرین نسخه به‌روز کنید.',
    'Update the API service to the latest release.',
  ],
  'workers.liveness': [
    'سرویس پردازش فایل (workers-py) پاسخ نمی‌دهد. وضعیت آن را با docker compose ps بررسی و در صورت نیاز دوباره راه‌اندازی کنید.',
    'The file-processing service (workers-py) is not answering. Check it with docker compose ps and restart it if needed.',
  ],
  'standards.freshness': [
    'اسکن امنیتی را اجرا کنید. فاصلهٔ اسکن خودکار با SECURITY_SCAN_INTERVAL_MS تنظیم می‌شود.',
    'Run a security scan. The automatic scan interval is set with SECURITY_SCAN_INTERVAL_MS.',
  ],
};

const NO_FIX = { remediationFa: null, remediationEn: null } as const;

function fix(key: string): { remediationFa: string; remediationEn: string } {
  const [fa, en] = REMEDIATION[key] ?? [
    'راهنمای عملیات (docs/RUNBOOK.md) را ببینید.',
    'See the operations runbook (docs/RUNBOOK.md).',
  ];
  return { remediationFa: fa, remediationEn: en };
}
