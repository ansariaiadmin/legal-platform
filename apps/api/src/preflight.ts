/**
 * Deployment preflight: catches configuration problems before the first user
 * sees an error.
 *
 *   npm run preflight -w @legal-platform/api
 *
 * Every check prints one line (✓ ok / ⚠ warning / ✗ failure) in Persian with
 * the English key names. The process exits with 1 if any check fails, 2 if
 * the preflight itself crashes, and 0 otherwise.
 */
import { createConnection } from 'node:net';
import { Pool } from 'pg';

type Verdict = 'ok' | 'warn' | 'fail';
interface Result {
  v: Verdict;
  text: string;
}

const PLACEHOLDER = /change[_-]?me|placeholder|your[_-]/i;

const line = (v: Verdict, message: string, detail = ''): Result => ({
  v,
  text: `${v === 'ok' ? '✓' : v === 'warn' ? '⚠' : '✗'} ${message}${detail ? ` — ${detail}` : ''}`,
});

async function socketProbe(host: string, port: number, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection(port, host);
    s.setTimeout(ms, () => {
      s.destroy();
      resolve(false);
    });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

/** Adapter key as the provider factory resolves it. */
function providerKey(env: NodeJS.ProcessEnv, category: 'sms' | 'payment' | 'ai'): string {
  const direct = { sms: env.SMS_ADAPTER, payment: env.PAYMENT_ADAPTER, ai: env.AI_PROVIDER_KEY }[category];
  return (direct || env[`${category.toUpperCase()}_PROVIDER`] || 'mock').toLowerCase();
}

async function checkDatabase(env: NodeJS.ProcessEnv, isProd: boolean, results: Result[]): Promise<void> {
  if (!env.DATABASE_URL) {
    results.push(line(isProd ? 'fail' : 'warn', 'DATABASE_URL تنظیم نشده است؛ ورود، نشست‌ها و کیف پول به Postgres نیاز دارند'));
    return;
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 4000, max: 1 });
  try {
    await pool.query('SELECT 1');
    const mig = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'migrations'`,
    );
    if (mig.rows[0]?.n === 0) {
      results.push(line('fail', 'پایگاه داده پاسخ می‌دهد اما مایگریشن‌ها اجرا نشده‌اند', 'npm run migrate:up -w @legal-platform/api'));
    } else {
      const applied = await pool
        .query(`SELECT max(id) AS latest FROM migrations`)
        .catch(() => ({ rows: [{ latest: null }] }));
      results.push(line('ok', 'Postgres در دسترس است و مایگریشن‌ها اجرا شده‌اند', `latest=${applied.rows[0]?.latest ?? '?'}`));
    }
  } catch (e) {
    results.push(line('fail', 'Postgres در دسترس نیست', (e as Error).message.slice(0, 90)));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';
  const results: Result[] = [];

  // 1. Database
  await checkDatabase(env, isProd, results);

  // 2. Storage driver
  const storage = env.STORAGE_DRIVER || (isProd && env.DATABASE_URL ? 'pg' : 'local');
  if (storage === 'pg' && !env.DATABASE_URL) {
    results.push(line('fail', 'STORAGE_DRIVER=pg بدون DATABASE_URL'));
  } else if (storage !== 'pg' && isProd) {
    results.push(line('warn', 'در production با STORAGE_DRIVER=local وضعیت روی دیسک همین سرور است؛ برای چند نمونه STORAGE_DRIVER=pg بگذارید'));
  } else {
    results.push(line('ok', `STORAGE_DRIVER=${storage}`));
  }

  // 3. Multi-instance deployments
  if (env.DEPLOYMENT_MODE === 'multi') {
    if (!env.REDIS_URL) {
      results.push(line('fail', 'DEPLOYMENT_MODE=multi بدون REDIS_URL؛ صف، رویدادها و محدودیت نرخ بین نمونه‌ها مشترک نمی‌شوند'));
    } else {
      const u = new URL(env.REDIS_URL);
      const up = await socketProbe(u.hostname || '127.0.0.1', Number(u.port) || 6379);
      results.push(up ? line('ok', 'Redis در دسترس است') : line('fail', 'REDIS_URL تنظیم شده اما Redis پاسخ نمی‌دهد'));
      if ((env.RATE_LIMIT_DRIVER ?? '') !== 'redis') {
        results.push(line('warn', 'DEPLOYMENT_MODE=multi بدون RATE_LIMIT_DRIVER=redis؛ محدودیت نرخ هر نمونه جداگانه شمرده می‌شود'));
      }
    }
  }

  // 4. Production hygiene
  if (isProd) {
    if (env.DEV_DASHBOARD_TOKEN) {
      results.push(line('fail', 'DEV_DASHBOARD_TOKEN در production تنظیم شده است؛ آن را حذف کنید'));
    }
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_MASTER_KEY']) {
      const v = env[k] ?? '';
      if (v.length < 32 || PLACEHOLDER.test(v)) {
        results.push(line('fail', `${k} خالی، کوتاه یا مقدار نمونه است؛ حداقل ۳۲ کاراکتر تصادفی لازم است`));
      } else {
        results.push(line('ok', `${k} تنظیم شده است`));
      }
    }
    if (!env.OWNER_PHONE && !env.OWNER_EMAIL) {
      results.push(line('warn', 'OWNER_PHONE و OWNER_EMAIL هر دو خالی‌اند؛ هیچ حسابی نقش مالک دفتر را نمی‌گیرد و داشبورد در دسترس نخواهد بود'));
    }
    if (!env.OTP_HASH_PEPPER) {
      results.push(line('warn', 'OTP_HASH_PEPPER خالی است؛ نصب‌کننده آن را می‌سازد، در نصب دستی خودتان مقدار تصادفی بگذارید'));
    }

    // Providers left on "mock" stay disabled in production (never fake success).
    for (const category of ['sms', 'payment', 'ai'] as const) {
      const key = providerKey(env, category);
      if (key === 'mock') {
        results.push(line('warn', `${category.toUpperCase()}_PROVIDER پیکربندی نشده است؛ این قابلیت تا تنظیم ارائه‌دهندهٔ واقعی غیرفعال می‌ماند`));
      } else {
        results.push(line('ok', `${category.toUpperCase()}_PROVIDER=${key}`));
      }
    }

    const pay = providerKey(env, 'payment');
    if (pay === 'zarinpal' && !env.ZARINPAL_MERCHANT_ID) {
      results.push(line('fail', 'PAYMENT_PROVIDER=zarinpal بدون ZARINPAL_MERCHANT_ID'));
    }
    if (pay !== 'mock' && !env.DATABASE_URL) {
      results.push(line('fail', 'درگاه پرداخت واقعی بدون DATABASE_URL؛ کیف پول فقط روی دفتر کل Postgres امن است'));
    }
    const sms = providerKey(env, 'sms');
    if (sms === 'kavenegar' && !env.KAVENEGAR_API_KEY) {
      results.push(line('fail', 'SMS_PROVIDER=kavenegar بدون KAVENEGAR_API_KEY'));
    }
    if (sms === 'ghasedak' && !env.GHASEDAK_API_KEY) {
      results.push(line('fail', 'SMS_PROVIDER=ghasedak بدون GHASEDAK_API_KEY'));
    }
  }

  // 5. Email
  if (env.EMAIL_DRIVER === 'smtp') {
    if (!env.SMTP_HOST) {
      results.push(line('fail', 'EMAIL_DRIVER=smtp بدون SMTP_HOST'));
    } else {
      const port = Number(env.SMTP_PORT) || 587;
      const up = await socketProbe(env.SMTP_HOST, port);
      results.push(up ? line('ok', 'سرور SMTP در دسترس است') : line('fail', 'سرور SMTP در دسترس نیست', `${env.SMTP_HOST}:${port}`));
    }
  }

  let worst: Verdict = 'ok';
  for (const r of results) {
    console.log(r.text);
    if (r.v === 'fail') worst = 'fail';
    else if (r.v === 'warn' && worst === 'ok') worst = 'warn';
  }
  console.log(
    worst === 'fail'
      ? '\n✗ Preflight ناموفق بود؛ خطاها را پیش از راه‌اندازی رفع کنید.'
      : worst === 'warn'
        ? '\n⚠ Preflight با هشدار گذشت؛ سرویس قابل اجراست، اما هشدارها را بررسی کنید.'
        : '\n✓ Preflight با موفقیت گذشت.',
  );
  return worst === 'fail' ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('✗ Preflight اجرا نشد:', (e as Error).message);
    process.exit(2);
  });
