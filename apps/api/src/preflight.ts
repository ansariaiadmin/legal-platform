/**
 * P11 — preflight for field trials: catches config rot BEFORE the first
 * human sees an error. Run: `npm run preflight -w @legal-platform/api`.
 *
 * Every check prints ONE honest line (✓ ok / ⚠ warn / ✗ fail) with a Persian
 * + English action. Exit code 1 if anything is ✗. Zero network false-positives:
 * unreachable dependencies FAIL LOUDLY here, cheaply, at deploy time.
 */
import { createConnection } from 'node:net';
import { Pool } from 'pg';

type Verdict = 'ok' | 'warn' | 'fail';
const line = (v: Verdict, fa: string, detail = ''): { v: Verdict; text: string } => ({
  v,
  text: `${v === 'ok' ? '✓' : v === 'warn' ? '⚠' : '✗'} ${fa}${detail ? ` — ${detail}` : ''}`,
});

async function socketProbe(host: string, port: number, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection(port, host);
    s.setTimeout(ms, () => { s.destroy(); resolve(false); });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

async function main(): Promise<number> {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';
  const results: Array<{ v: Verdict; text: string }> = [];

  // 1. database
  if (!env.DATABASE_URL) {
    results.push(line(isProd ? 'fail' : 'warn', 'DATABASE_URL تنظیم نیست / DATABASE_URL unset — OTP/sessions نیازمند Postgres‌اند'));
  } else {
    const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 4000, max: 1 });
    try {
      await pool.query('SELECT 1');
      const mig = await pool.query(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'migrations'`,
      );
      if (mig.rows[0]?.n === 0) {
        results.push(line('fail', 'DB پاسخ می‌دهد اما مایگریشن‌ها اجرا نشده / migrations not run', 'npm run migrate:up -w @legal-platform/api'));
      } else {
        const applied = await pool.query(`SELECT max(id) AS latest FROM migrations`).catch(() => ({ rows: [{ latest: null }] }));
        results.push(line('ok', 'Postgres سالم و جدول migrations هست / Postgres up, migrations table present', `latest=${applied.rows[0]?.latest ?? '?'}`));
      }
    } catch (e) {
      results.push(line('fail', 'Postgres در دسترس نیست / database unreachable', (e as Error).message.slice(0, 90)));
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  // 2. storage driver coherence
  const sdriver = env.STORAGE_DRIVER || 'local';
  if (sdriver === 'pg' && !env.DATABASE_URL) {
    results.push(line('fail', 'STORAGE_DRIVER=pg بدون DATABASE_URL'));
  } else if (sdriver !== 'pg' && isProd) {
    results.push(line('warn', 'production با storage=local: توکن‌ها/قفل‌ها روی دیسک محلی‌اند — برای چند سرور بگذار STORAGE_DRIVER=pg'));
  } else {
    results.push(line('ok', `storage driver: ${sdriver}`));
  }

  // 3. multi-replica discipline
  if (env.DEPLOYMENT_MODE === 'multi') {
    if (!env.REDIS_URL) {
      results.push(line('fail', 'DEPLOYMENT_MODE=multi ولی REDIS_URL ندارد — صف/رویداد/کف rate-limit اشتراکی نمی‌شود'));
    } else {
      const u = new URL(env.REDIS_URL);
      const up = await socketProbe(u.hostname || '127.0.0.1', Number(u.port) || 6379);
      results.push(up
        ? line('ok', 'Redis پاسخ می‌دهد / Redis reachable')
        : line('fail', 'REDIS_URL ست ولی پاسخ نمی‌دهد / Redis unreachable'));
      if ((env.RATE_LIMIT_DRIVER ?? '') !== 'redis') {
        results.push(line('warn', 'multi بدون RATE_LIMIT_DRIVER=redis: کف per-IP هر رپلیکا جداست'));
      }
    }
  }

  // 4. production hygiene — the guard lines that are buyable-by-mistake
  if (isProd) {
    if (env.DEV_DASHBOARD_TOKEN) results.push(line('fail', 'DEV_DASHBOARD_TOKEN در production — حذفش کن (دربِ توسعه)'));
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const v = env[k] ?? '';
      results.push(v.length >= 32 ? line('ok', `${k} قوی است`) : line('fail', `${k} کوتاه/خالی است — حداقل ۳۲ کاراکتر تصادفی`));
    }
    for (const probe of ['SMS_ADAPTER', 'PAYMENT_ADAPTER'] as const) {
      if (env[probe]) results.push(line('ok', `${probe}=${env[probe]}`));
    }

    // FIELD REVIEW 2026-09-05 #5 — money lane must never run on
    // fire-and-forget storage. A real gateway without the single-replica
    // posture documented is a double-spend invitation.
    const pay = (env.PAYMENT_ADAPTER ?? '').toLowerCase();
    if (pay && pay !== 'mock' && pay !== 'local') {
      if (pay === 'zarinpal' && !env.ZARINPAL_MERCHANT_ID) {
        results.push(line('fail', 'PAYMENT_ADAPTER=zarinpal بدون ZARINPAL_MERCHANT_ID'));
      }
      if (env.WALLET_REPLICA_OK !== 'single-replica-acknowledged') {
        results.push(line('warn',
          'WALLET با درگاه واقعی: تراز در JSON ‌درون‌حافظه است — تا مهاجرت لجر Postgres فقط تک‌نمونه اجرا کن (WALLET_REPLICA_OK=single-replica-acknowledged)'));
      }
    }
  }

  // 5. email factor
  if (env.EMAIL_DRIVER === 'smtp') {
    if (!env.SMTP_HOST) {
      results.push(line('fail', 'EMAIL_DRIVER=smtp بدون SMTP_HOST'));
    } else {
      const up = await socketProbe(env.SMTP_HOST, Number(env.SMTP_PORT) || 587);
      results.push(up ? line('ok', 'SMTP relay reachable') : line('fail', 'SMTP relay unreachable', `${env.SMTP_HOST}:${env.SMTP_PORT || 587}`));
    }
  }

  let worst: Verdict = 'ok';
  for (const r of results) {
    console.log(r.text);
    if (r.v === 'fail') worst = 'fail';
    else if (r.v === 'warn' && worst === 'ok') worst = 'warn';
  }
  console.log(worst === 'fail' ? '\n✗ preflight FAILED — خطاها را قبل از سرو نمایشی رفع کن.' :
    worst === 'warn' ? '\n⚠ preflight OK-with-warnings — قابل سرو، ولی هشدارها را بخوان.' :
      '\n✓ preflight PASSED — آمادهٔ تست میدانی.');
  return worst === 'fail' ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('✗ preflight crashed honestly:', (e as Error).message);
  process.exit(2);
});
