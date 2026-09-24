# 🔒 راهنمای سخت‌سازی امنیتی

این سند راهنمای کامل امنیت، سخت‌سازی، Rate Limiting، اعتبارسنجی ورودی و محافظت از سکرت‌ها برای پلتفرم حقوقی است.

---

## فهرست مطالب

1. [معماری امنیتی](#معماری-امنیتی)
2. [اسکن سکرت‌ها](#اسکن-سکرتها)
3. [Rate Limiting](#rate-limiting)
4. [اعتبارسنجی ورودی](#اعتبارسنجی-ورودی)
5. [CORS سخت‌گیرانه](#cors-سختگیرانه)
6. [Helmet.js و هدرهای امنیتی](#helmetjs-و-هدرهای-امنیتی)
7. [احراز هویت و مجوز](#احراز-هویت-و-مجوز)
8. [رمزنگاری](#رمزنگاری)
9. [تست‌های امنیتی](#تستهای-امنیتی)
10. [چک‌لیست تولید](#چکلیست-تولید)

---

## معماری امنیتی

```
┌─────────────────────────────────────────────────────────────┐
│                    Internet / User                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Nginx Reverse Proxy                                        │
│  - Rate limiting (global)                                   │
│  - TLS termination                                          │
│  - Security headers                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  API Server (NestJS)                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Helmet.js  │  │   CORS       │  │  Rate Limiting   │  │
│  │   Security   │  │   Strict     │  │  Per Endpoint    │  │
│  │   Headers    │  │              │  │  Login 5/min/IP  │  │
│  └──────────────┘  └──────────────┘  │  Upload 10/h/user│  │
│                                      │  API 1000/h/user │  │
│  ┌──────────────┐  ┌──────────────┐  └──────────────────┘  │
│  │   Zod/Joi    │  │   Secret     │                        │
│  │   Validation │  │   Scan       │                        │
│  │   All Inputs │  │   Clean      │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Database (PostgreSQL) + Redis                              │
│  - Encrypted at rest (provider_configs)                     │
│  - No secrets in backups                                    │
│  - Audit logs                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## اسکن سکرت‌ها

### ابزار `tools/security/secret-scan.mjs`

اسکریپت اسکن سکرت‌ها به صورت خودکار کد را برای یافتن سکرت‌های هاردکد شده بررسی می‌کند.

**قوانین اسکن:**

| قانون | الگو | شدت |
|-------|------|-----|
| `aws-access-key` | `AKIA[0-9A-Z]{16}` | critical |
| `private-key-block` | `-----BEGIN ... PRIVATE KEY-----` | critical |
| `gh-token` | `gh[pousr]_[A-Za-z0-9]{36,}` | critical |
| `slack-token` | `xox[baprs]-[A-Za-z0-9-]{10,}` | high |
| `hardcoded-credential-shape` | `password: "..."` با طول ۱۶+ | high |
| `bearer-literal` | `Bearer ...` با طول ۳۲+ | high |

**اجرا:**

```bash
# اسکن دستی
npm run security:secrets

# خروجی در صورت پاک بودن
# Scanning 265 files...
# 0 findings — clean ✅

# خروجی در صورت وجود سکرت
# [CRITICAL] aws-access-key in src/config.ts:42
# [HIGH] hardcoded-credential-shape in src/auth.ts:15
```

**فایل‌های نادیده گرفته شده:**

- `test/`, `*.spec.ts`, `*.test.ts` — فیکسچرها ممکن است سکرت نمونه داشته باشند
- `docs/`, `README`, `AGENTS` — مستندات
- `.env.example` — نمونه
- `i18n/` — ترجمه‌ها
- `secret-scan/` — قوانین خود اسکن

**Allowlist:**

اگر موردی false positive است، به `tools/security/secret-scan.allowlist.json` اضافه کنید:

```json
{
  "skipFiles": ["path/to/file.ts"],
  "allowedPatterns": [
    {
      "ruleId": "hardcoded-credential-shape",
      "path": "src/example.ts",
      "line": 10,
      "reason": "This is a test fixture with fake credential"
    }
  ]
}
```

**تست خودکار:**

```bash
# تست در CI
npm test -- security/repo-secrets.spec.ts
```

**نکات:**

- هرگز سکرت واقعی را commit نکنید
- از `.env` برای سکرت‌ها استفاده کنید
- `.env` را در `.gitignore` قرار دهید
- از `chmod 600 .env` استفاده کنید
- سکرت‌ها را در Vault یا 1Password نگه دارید

---

## Rate Limiting

### معماری دو لایه

1. **Global Rate Limit (Floor):** ۳۰۰ درخواست در دقیقه per IP (برای همه)
2. **Per-Endpoint Rate Limit:** محدودیت خاص برای هر اندپوینت

### قوانین Per-Endpoint

| اندپوینت | محدودیت | کلید | پیام فارسی |
|----------|---------|------|------------|
| **Login** | ۵ در دقیقه | IP | تعداد تلاش ورود بیش از حد مجاز است |
| **Upload** | ۱۰ در ساعت | User | تعداد آپلود بیش از حد مجاز است |
| **API** | ۱۰۰۰ در ساعت | User | تعداد درخواست API بیش از حد مجاز است |
| **Strict** | ۲۰ در دقیقه | IP | تعداد درخواست بیش از حد مجاز |

### پیاده‌سازی

```typescript
import { EndpointRateLimitGuard, RateLimitPresets, EndpointRateLimit } from './common/endpoint-rate-limit.guard';

// در کنترلر
@Controller('auth')
export class AuthController {
  @Post('otp/request')
  @UseGuards(EndpointRateLimitGuard)
  @EndpointRateLimit(RateLimitPresets.LOGIN)
  async requestOtp() { ... }

  @Post('upload')
  @UseGuards(JwtAccessGuard, EndpointRateLimitGuard)
  @EndpointRateLimit(RateLimitPresets.UPLOAD)
  async uploadFile() { ... }

  @Get('dashboard/data')
  @UseGuards(JwtAccessGuard, EndpointRateLimitGuard)
  @EndpointRateLimit(RateLimitPresets.API)
  async getData() { ... }
}
```

### سرویس RateLimitService

```typescript
// In-memory fixed-window counter
const decision = rateLimitService.consume(key, {
  limit: 5,
  windowMs: 60_000, // 1 minute
  cooldownMs: 1000, // optional: min spacing
  lockMs: 60_000,   // optional: lockout after limit
});

if (!decision.allowed) {
  // 429 Too Many Requests
  throw new HttpException({
    message: 'Too many requests',
    retryAfter: decision.retryAfterSeconds,
  }, 429);
}
```

### Redis-Backed برای Multi-Node

```bash
# فعال‌سازی Redis rate limiter برای چند replica
RATE_LIMIT_DRIVER=redis
REDIS_URL=redis://redis:6379
```

**مزیت:** همه replicaها یک bucket مشترک دارند — حملات DDoS توزیع شده هم محدود می‌شود.

### هدرهای Rate Limit

```http
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 2
Retry-After: 60
```

### تست

```bash
# تست دستی
for i in {1..10}; do curl -s http://localhost:8080/api/auth/otp/request -X POST -d '{"phone":"09123456789"}' -H "Content-Type: application/json" | head -1; done

# باید بعد از 5 درخواست، 429 بگیرد
```

---

## اعتبارسنجی ورودی

### Zod/Joi Validation (Fallback Regex)

ما از ValidationPipe نست با class-validator استفاده می‌کنیم، و برای جاهایی که zod/joi در دسترس نیست، از regex fallback.

**ساختار:**

```typescript
import { ZodValidationPipe, PersianValidation, AuthSchemas } from './common/zod-validation.pipe';

// استفاده از Zod-like schema
@Post('otp/request')
async requestOtp(@Body(new ZodValidationPipe(AuthSchemas.phone)) dto: any) {
  // dto.phone حتما معتبر است
}

// یا regex مستقیم
if (!PersianValidation.phone.test(phone)) {
  throw new BadRequestException('Invalid phone');
}
```

### الگوهای اعتبارسنجی

| فیلد | الگو | توضیح |
|------|------|-------|
| `phone` | `/^(\+98\|0)?9\d{9}$/` | موبایل ایرانی |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | ایمیل |
| `otpCode` | `/^\d{4,8}$/` | کد OTP ۴-۸ رقمی |
| `uuid` | `/^[0-9a-f]{8}-...$/i` | UUID v4 |
| `nationalId` | `/^\d{10}$/` | کد ملی ۱۰ رقمی |
| `password` | `/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/` | حداقل ۸ کاراکتر، حرف بزرگ، کوچک، عدد |
| `noHtml` | `/^[^<>]*$/` | بدون تگ HTML (XSS) |
| `safeFilename` | `/^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$/` | نام فایل امن |

### Sanitization

```typescript
import { sanitizeInput } from './common/zod-validation.pipe';

function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '')           // حذف < >
    .replace(/javascript:/gi, '')   // حذف javascript:
    .replace(/on\w+\s*=/gi, '')     // حذف onclick= etc
    .trim();
}

// استفاده
const clean = sanitizeInput(userInput);
```

### DTO Validation با class-validator

```typescript
import { IsString, IsPhoneNumber, Matches, Length } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^(\+98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر' })
  phone: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^(\+98|0)?9\d{9}$/)
  phone: string;

  @IsString()
  @Length(4, 8)
  @Matches(/^\d{4,8}$/)
  code: string;
}
```

### Global ValidationPipe

```typescript
// در setup.ts
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,        // حذف فیلدهای اضافی
    forbidNonWhitelisted: true, // خطا برای فیلدهای اضافی
    forbidUnknownValues: true,
  }),
);
```

---

## CORS سخت‌گیرانه

### تنظیمات

```typescript
// در setup.ts
const origins = corsOrigins(env); // از APP_URL + CORS_ORIGINS

app.enableCors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // mobile apps, curl
    if (origins.length === 0) return callback(null, false); // deny all if not configured
    if (origins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  maxAge: 86400,
});
```

### متغیرهای محیطی

```bash
# دامنه اصلی (همیشه مجاز)
APP_URL=https://legal.example.com

# دامنه‌های اضافی مجاز (comma-separated)
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# در تولید: اگر CORS_ORIGINS خالی باشد، هیچ cross-origin مجاز نیست
# در توسعه: می‌توانید * را برای تست قرار دهید (توصیه نمی‌شود)
```

### تست CORS

```bash
# درخواست مجاز
curl -H "Origin: https://legal.example.com" http://localhost:8080/api/health -v

# درخواست غیرمجاز (باید CORS error بدهد)
curl -H "Origin: https://evil.com" http://localhost:8080/api/health -v
```

---

## Helmet.js و هدرهای امنیتی

### هدرهای پیاده‌سازی شده

| هدر | مقدار | توضیح |
|-----|-------|-------|
| `X-Content-Type-Options` | `nosniff` | جلوگیری از MIME sniffing |
| `X-Frame-Options` | `DENY` | جلوگیری از Clickjacking |
| `Referrer-Policy` | `no-referrer` | عدم ارسال referrer |
| `Permissions-Policy` | `camera=(), microphone=()...` | غیرفعال کردن APIهای حساس |
| `Cross-Origin-Opener-Policy` | `same-origin` | ایزوله کردن پنجره‌ها |
| `X-DNS-Prefetch-Control` | `off` | غیرفعال کردن DNS prefetch |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | HSTS (فقط در production) |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | CSP سخت‌گیرانه برای API |
| `X-Permitted-Cross-Domain-Policies` | `none` | جلوگیری از Flash |
| `Origin-Agent-Cluster` | `?1` | ایزوله کردن origin |
| `Cache-Control` | `no-store` برای auth | عدم کش OTP |

### پیاده‌سازی Helmet Middleware

```typescript
// apps/api/src/common/helmet.middleware.ts
export function helmetMiddleware(options: HelmetOptions = {}) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // ... و بقیه
    next();
  };
}

// در setup.ts
app.use(helmetMiddleware(defaultHelmetConfig));
app.use(securityHeadersMiddleware(env.isProduction));
```

### تفاوت با Helmet.js واقعی

ما از پیاده‌سازی سبک خود استفاده می‌کنیم که همان هدرهای Helmet را می‌دهد بدون وابستگی خارجی. اگر `helmet` npm نصب باشد، می‌توانید آن را جایگزین کنید:

```bash
npm install helmet
```

```typescript
import helmet from 'helmet';
app.use(helmet());
```

### تست هدرها

```bash
curl -s -D - http://localhost:8080/api/health -o /dev/null | grep -i "x-\|security\|csp"

# باید ببینید:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Referrer-Policy: no-referrer
# Content-Security-Policy: default-src 'none'; ...
```

---

## احراز هویت و مجوز

### JWT

- **Access Token:** ۱۵ دقیقه
- **Refresh Token:** ۷ روز
- **الگوریتم:** HS256 با سکرت قوی

### OTP

- **طول:** ۶ رقم
- **انقضا:** ۲ دقیقه
- **Rate Limit:** ۵ در دقیقه per IP، ۳ تلاش برای هر کد
- **ذخیره:** هش شده با pepper

### Passkey (WebAuthn)

- **مرز اصلی ورود:** بیومتریک/اثر انگشت
- **OTP فقط بازیابی:** مسیر دوم

### RBAC

| نقش | دسترسی |
|-----|--------|
| `lawyer_owner` | همه چیز، بکاپ، تنظیمات |
| `staff` | پرونده‌ها، CRM، بدون بکاپ |
| `client` | فقط پرونده خود |
| `operator` | فقط setup |

---

## رمزنگاری

### در حالت سکون (At Rest)

- `provider_configs`: رمزنگاری با `ENCRYPTION_MASTER_KEY` (AES-256-GCM)
- بکاپ‌ها: اختیاری AES-256-CBC با `BACKUP_ENCRYPTION_KEY`
- پسوردها: bcrypt با salt

### در حال انتقال (In Transit)

- TLS 1.2+ از طریق Nginx
- HSTS با `includeSubDomains`
- `Secure` flag برای کوکی‌ها (در صورت استفاده)

### کلیدها

```bash
# تولید کلید قوی
openssl rand -base64 32

# در .env
JWT_ACCESS_SECRET="کلید-تصادفی-طولانی-حداقل-۳۲-کاراکتر"
JWT_REFRESH_SECRET="کلید-دیگر-تصادفی-طولانی"
ENCRYPTION_MASTER_KEY="کلید-اصلی-رمزنگاری-۳۲-بایت"
BACKUP_ENCRYPTION_KEY="کلید-بکاپ-جداگانه"
```

---

## تست‌های امنیتی

### ۵ تست الزامی

1. **Rate Limit:** تست ۵/min/IP برای login، ۱۰/hour/user برای upload، ۱۰۰۰/hour/user برای API
2. **Invalid Input:** تست ورودی‌های نامعتبر (XSS، SQL injection، phone invalid)
3. **Secret Scan Clean:** ۰ یافته در اسکن سکرت‌ها
4. **CORS Strict:** تست مسدود کردن originهای غیرمجاز
5. **Helmet Headers:** تست وجود هدرهای امنیتی

### اجرای تست‌ها

```bash
# همه تست‌های امنیتی
npm test -- security/

# تست خاص
npm test -- hardening-prod.spec.ts

# اسکن سکرت‌ها
npm run security:secrets

# تست نفوذ دستی
curl -X POST http://localhost:8080/api/auth/otp/request -d '{"phone":"<script>alert(1)</script>"}' -H "Content-Type: application/json"
# باید 400 بدهد، نه 500
```

### نمونه تست Rate Limit

```typescript
it('login rate limit: 5/min/IP', () => {
  const rule = { limit: 5, windowMs: 60_000 };
  for (let i = 0; i < 5; i++) {
    expect(rateLimitService.consume('login:1.1.1.1', rule).allowed).toBe(true);
  }
  expect(rateLimitService.consume('login:1.1.1.1', rule).allowed).toBe(false);
});
```

---

## چک‌لیست تولید

### قبل از انتشار

- [ ] `npm run security:secrets` — ۰ یافته
- [ ] `.env` با `chmod 600` و در `.gitignore`
- [ ] همه سکرت‌ها تصادفی و قوی (حداقل ۳۲ کاراکتر)
- [ ] `CORS_ORIGINS` فقط دامنه‌های مجاز
- [ ] `APP_URL` صحیح و HTTPS
- [ ] Rate limiting فعال برای همه اندپوینت‌ها
- [ ] Helmet headers در همه پاسخ‌ها
- [ ] ValidationPipe با `whitelist: true`
- [ ] HSTS فقط در production
- [ ] بکاپ‌ها رمزنگاری شده
- [ ] لاگ‌ها شامل سکرت نیستند
- [ ] `X-Powered-By` حذف شده
- [ ] `POSTGRES_PASSWORD` قوی
- [ ] `JWT_*_SECRET` قوی و متفاوت
- [ ] تست‌های امنیتی پاس می‌شوند

### پس از انتشار

- [ ] `curl /api/health` — هدرهای امنیتی را چک کنید
- [ ] تست CORS با origin غیرمجاز
- [ ] تست Rate Limit با ۱۰ درخواست سریع
- [ ] بررسی لاگ‌ها برای خطاهای امنیتی
- [ ] تنظیم هشدار برای حملات (HighErrorRate)

### مانیتورینگ امنیتی

- هشدار برای نرخ خطای بالا (>5%)
- هشدار برای خطاهای DB
- لاگ همه درخواست‌های ناموفق احراز هویت
- بررسی روزانه `npm audit`
- آپدیت منظم وابستگی‌ها

---

## منابع

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [Helmet.js](https://helmetjs.github.io/)
- [NestJS Security](https://docs.nestjs.com/security/helmet)
- [RUNBOOK.md](./RUNBOOK.md)
- [MONITORING.md](./MONITORING.md)
