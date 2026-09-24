# 📘 راهنمای اجرای قدم‌به‌قدم (Runbook) — نسخه تولید

این سند برای کسی نوشته شده که فقط یک سرور Ubuntu و این پوشه را دارد. همه‌چیز قدم‌به‌قدم، از صفر تا داشبورد بالا، بکاپ مجدول، مانیتورینگ، امنیت و بازیابی فاجعه.

> **نسخه:** ۲.۰ — تولید سخت‌شده (Production Hardened)  
> **تاریخ:** ۱۴۰۳/۰۷/۰۲  
> **زبان:** فارسی کامل برای تیم ایرانی

---

## فهرست مطالب

1. [پیش‌نیازها](#قدم-۰--پیشنیازها)
2. [نصب](#قدم-۱--نصب-یک-دستور)
3. [ستاپ‌ویزارد](#قدم-۲--ستاپویزارد-اولین-ورود)
4. [راستی‌آزمایی سلامت](#قدم-۳--راستیآزمایی-سلامت)
5. [پیکربندی](#پیکربندی-کامل)
6. [بکاپ تولید](#بکاپ-تولید)
7. [مانیتورینگ و هشدار](#مانیتورینگ-و-هشدار)
8. [سخت‌سازی امنیتی](#سختسازی-امنیتی)
9. [پردازش فارسی](#پردازش-فارسی)
10. [ایجنت‌های حقوقی](#ایجنتهای-حقوقی)
11. [عملیات روزمره](#عملیات-روزمره)
12. [به‌روزرسانی](#بهروزرسانی)
13. [بازیابی فاجعه](#بازیابی-فاجعه)
14. [عیب‌یابی](#عیب‌یابی-سریع)

---

## قدم ۰ — پیش‌نیازها

### سخت‌افزار

- **سرور Ubuntu 22.04 یا 24.04 (تست‌شده روی noble)**
- حداقل ۴ گیگ رم (۸ گیگ با AI توصیه می‌شود)
- ۴۰ گیگ فضای خالی (۱۰۰ گیگ برای تولید توصیه می‌شود)
- CPU ۲ هسته‌ای (۴ هسته برای تولید)

### نرم‌افزار

- دسترسی `sudo`
- یک دامنه (اختیاری برای آغاز — روی `localhost` هم کار می‌کند)
- اینترنت برای دانلود ایمیج‌ها

### بررسی اولیه

```bash
sudo ./setup.sh --check
```

اگر هر سه خط ✔ سبز بود، یعنی همه‌چیز برای نصب آماده است.

**نصب‌کننده خودش Docker را اگر نباشد نصب می‌کند.**

---

## قدم ۱ — نصب (یک دستور)

```bash
sudo ./setup.sh
```

این دستور به ترتیب:

1. سیستم‌عامل، رم و فضای دیسک را اعتبارسنجی می‌کند
2. Docker و compose plugin را (در صورت نیاز) نصب می‌کند
3. فایل `.env` می‌سازد و **همهٔ سکرت‌ها را تصادفی تولید می‌کند**:
   - `JWT_ACCESS_SECRET`، `JWT_REFRESH_SECRET`
   - `ENCRYPTION_MASTER_KEY`
   - `POSTGRES_PASSWORD` (و همان پسورد داخل `DATABASE_URL` سینک می‌شود)
   - `OTP_HASH_PEPPER` (فقط اگر خالی باشد — تا OTPهای صادرشده خراب نشوند)
   - `BACKUP_ENCRYPTION_KEY` (برای بکاپ رمزنگاری شده)
4. ایمیج‌ها را build و سرویس‌ها را بالا می‌آورد
5. میگریشن‌های دیتابیس را اجرا می‌کند
6. تا لحظه‌ای که `/api/health` پاسخ `ok` بدهد صبر می‌کند

در پایان آدرس داشبورد را چاپ می‌کند.

> ⏳ اولین اجرا (دانلود ایمیج‌ها) بسته به اینترنت ۵ تا ۱۵ دقیقه طول می‌کشد.

### نصب تولید (Production)

```bash
# برای تولید از docker-compose.prod.yml استفاده کنید
sudo docker compose -f docker-compose.prod.yml up -d --build

# بررسی سلامت
curl -s http://localhost:8080/api/health | jq
curl -s http://localhost:8080/api/ready | jq
curl -s http://localhost:8080/api/metrics | head -20
```

**ویژگی‌های نسخه تولید:**

- Resource limits (CPU/memory) برای همه سرویس‌ها
- Logging با rotation (file+stdout)
- Restart policies: `unless-stopped`
- Volume persistence برای postgres, redis, uploads
- Healthchecks برای همه سرویس‌ها (api, web, worker, proxy, postgres, redis)
- Prometheus + Grafana (پروفایل monitoring)

---

## قدم ۲ — ستاپ‌ویزارد (اولین ورود)

1. مرورگر را باز کنید: **http://localhost:8080**
2. چون هنوز مالکی ساخته نشده، **ویزارد راه‌اندازی خودکار بالا می‌آید**:
   - ساخت حساب مالک (شماره موبایل + نام)
   - ارسال OTP (در حالت dev، کد در لاگ container چاپ می‌شود: `docker compose logs api | grep -i otp`)
   - تایید OTP و ورود

3. در داشبورد، از بخش **تنظیمات**:
   - **پنل پیامک کاوه‌نگار** (`KAVENEGAR_API_KEY`) را اگر دارید وارد کنید — یعنی OTPهای واقعی با SMS بروند. بدون کلید، پیامک ماک سرو می‌شود.
   - **درگاه زرین‌پال** را اگر merchant-id دارید وارد کنید.
   - **پروایدر هوش‌مصنوعی**: مسیر `AI_PROVIDER_KEY` را با کلیک روی تنظیمات provider فعال کنید.

4. (توصیه‌شده) برای نسخهٔ نهایی **پس‌کی/اثر انگشت** را هم در تنظیمات اکانت ثبت کنید — ورود اصلی پلتفرم پس‌کی است و OTP فقط مسیر بازیابی است.

---

## قدم ۳ — راستی‌آزمایی سلامت

```bash
# وضعیت همه سرویس‌ها
./scripts/diagnostics.sh

# Health check
curl -s http://localhost:8080/api/health | jq
# → {"status":"ok", "service":"api", "uptimeSeconds":..., "checks":{"database":{"status":"up"}, "redis":{"status":"up"}}}

# Readiness check (برای K8s / Load Balancer)
curl -s http://localhost:8080/api/ready | jq
# → {"ready":true, "checks":{...}}

# Metrics (Prometheus)
curl -s http://localhost:8080/api/metrics | head -30

# Dashboard HTML
# مرورگر: http://localhost:8080/api/health/dashboard

# بررسی Docker
docker compose ps
docker compose logs api --tail=50
docker compose logs postgres --tail=20
```

**اگر همه `ok` و `ready=true` بود، نصب موفق است.**

---

## پیکربندی کامل

### فایل `.env`

```bash
# دیتابیس
DATABASE_URL=postgresql://legal:STRONG_PASSWORD@postgres:5432/legal_platform
POSTGRES_PASSWORD=STRONG_PASSWORD
POSTGRES_USER=legal
POSTGRES_DB=legal_platform

# Redis
REDIS_URL=redis://redis:6379

# JWT (تصادفی تولید می‌شود)
JWT_ACCESS_SECRET=random-32-chars-min
JWT_REFRESH_SECRET=another-random-32-chars

# رمزنگاری
ENCRYPTION_MASTER_KEY=32-byte-base64-key
BACKUP_ENCRYPTION_KEY=another-strong-key-for-backup

# اپلیکیشن
APP_URL=https://legal.example.com
NODE_ENV=production
PORT=3001
LOG_LEVEL=info

# CORS (دامنه‌های مجاز)
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# Rate Limiting
RATE_LIMIT_DRIVER=redis
GLOBAL_RATE_LIMIT_PER_MIN=300

# پروایدرها
SMS_PROVIDER=kavenegar
KAVENEGAR_API_KEY=your-kavenegar-key
PAYMENT_PROVIDER=zarinpal
ZARINPAL_MERCHANT_ID=your-merchant-id

# AI
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_EMBEDDING_DIMENSION=1024

# Storage
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=/app/uploads

# مانیتورینگ
TELEGRAM_BOT_TOKEN=123456789:ABC...
TELEGRAM_ALERT_CHAT_ID=-1001234567890
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# بکاپ S3
S3_BUCKET=legal-platform-backups
S3_ENDPOINT=https://s3.example.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Prometheus/Grafana
GRAFANA_PASSWORD=strong-grafana-password
```

### امنیت `.env`

```bash
chmod 600 .env
# هرگز در git commit نکنید
# در .gitignore قرار دارد
```

---

## بکاپ تولید

### سیستم بکاپ حرفه‌ای

ما دو اسکریپت بکاپ داریم:

1. **`backup.sh`** — ساده، برای dev و تست
2. **`backup-prod.sh`** — حرفه‌ای، برای تولید با رمزنگاری و S3

### بکاپ دستی تولید

```bash
# روزانه ساده
./scripts/backup-prod.sh --type daily

# روزانه با رمزنگاری
BACKUP_ENCRYPTION_KEY="your-strong-key" ./scripts/backup-prod.sh --type daily --encrypt

# هفتگی با رمزنگاری و S3
BACKUP_ENCRYPTION_KEY="..." S3_BUCKET="legal-backups" ./scripts/backup-prod.sh --type weekly --encrypt --upload

# ماهانه کامل
./scripts/backup-prod.sh --type monthly --encrypt --upload
```

### سیاست نگهداری ۷-۴-۱۲

- **۷ روزانه:** ۷ بکاپ آخر روزانه (۱ هفته)
- **۴ هفتگی:** ۴ بکاپ آخر هفتگی (۱ ماه)
- **۱۲ ماهانه:** ۱۲ بکاپ آخر ماهانه (۱ سال)

اسکریپت به صورت خودکار قدیمی‌ها را پاک می‌کند.

### کرون جاب‌های توصیه‌شده

```bash
sudo crontab -e

# روزانه ساعت 3 صبح
0 3 * * * /path/to/legal-platform/scripts/backup-prod.sh --type daily --encrypt --upload >> /var/log/legal-backup.log 2>&1

# هفتگی یکشنبه ساعت 2 صبح
0 2 * * 0 /path/to/legal-platform/scripts/backup-prod.sh --type weekly --encrypt --upload >> /var/log/legal-backup.log 2>&1

# ماهانه روز 1 ساعت 1 صبح
0 1 1 * * /path/to/legal-platform/scripts/backup-prod.sh --type monthly --encrypt --upload >> /var/log/legal-backup.log 2>&1

# بررسی سلامت هر روز ساعت 6 صبح
0 6 * * * /path/to/legal-platform/scripts/diagnostics.sh >> /var/log/legal-diagnostics.log 2>&1
```

### بازیابی

```bash
# لیست بکاپ‌ها
ls -lh backups/daily/ backups/weekly/ backups/monthly/

# بازیابی (نیاز به تایید صریح)
./scripts/restore.sh --confirm backups/daily/backup-daily-20240101-120000.tar.gz

# بازیابی از نسخه رمزنگاری شده
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in backups/daily/backup-daily-20240101-120000.tar.gz.enc \
  -out /tmp/restore.tar.gz \
  -pass pass:"$BACKUP_ENCRYPTION_KEY"

./scripts/restore.sh --confirm /tmp/restore.tar.gz
```

**جزئیات کامل:** [BACKUP.md](./BACKUP.md)

---

## مانیتورینگ و هشدار

### اندپوینت‌ها

| اندپوینت | توضیح | استفاده |
|----------|-------|---------|
| `/api/health` | Liveness + DB + Redis + Storage + Disk | Load Balancer, K8s liveness |
| `/api/ready` | Readiness — آماده دریافت ترافیک؟ | K8s readiness |
| `/api/metrics` | Prometheus metrics | Prometheus scraper |
| `/api/health/dashboard` | داشبورد HTML فارسی | مشاهده سریع |
| `/api/health/alerts` | هشدارهای اخیر | API |
| `/api/health/stats` | آمار JSON | API |

### Prometheus

```bash
# فعال‌سازی monitoring
docker compose --profile monitoring up -d
# یا prod
docker compose -f docker-compose.prod.yml --profile monitoring up -d prometheus grafana

# دسترسی
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3000 (admin / GRAFANA_PASSWORD)
```

### قوانین هشدار

- **HighErrorRate:** نرخ خطا >5% برای ۵ دقیقه → critical
- **DB Failures:** >5 خطا در ۵ دقیقه → critical
- **Disk <10%:** فضای دیسک کم → critical
- **Agent Failures:** >10 خطا در ۱۰ دقیقه → warning
- **Backup Failures:** هر خطای بکاپ → critical

### تلگرام و اسلک

```bash
# در .env
TELEGRAM_BOT_TOKEN="123456789:ABC..."
TELEGRAM_ALERT_CHAT_ID="-1001234567890"
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."

# تست
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"$TELEGRAM_ALERT_CHAT_ID\", \"text\": \"تست مانیتورینگ\"}"
```

**جزئیات کامل:** [MONITORING.md](./MONITORING.md)

---

## سخت‌سازی امنیتی

### لایه‌های امنیتی

1. **Secret Scan:** اسکن خودکار سکرت‌ها — `npm run security:secrets` باید ۰ یافته باشد
2. **Rate Limiting:**
   - Login: ۵ در دقیقه per IP
   - Upload: ۱۰ در ساعت per User
   - API: ۱۰۰۰ در ساعت per User
   - Global: ۳۰۰ در دقیقه per IP
3. **Input Validation:** Zod/Joi + regex fallback + class-validator
4. **CORS سخت‌گیرانه:** فقط دامنه‌های مجاز
5. **Helmet.js:** هدرهای امنیتی (X-Frame-Options, HSTS, CSP, ...)

### هدرهای امنیتی

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=15552000; includeSubDomains (فقط prod)
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
Permissions-Policy: camera=(), microphone=(), ...
```

### تست امنیتی

```bash
# اسکن سکرت‌ها
npm run security:secrets

# تست هدرها
curl -s -D - http://localhost:8080/api/health -o /dev/null | grep -i "x-\|csp\|hsts"

# تست Rate Limit
for i in {1..10}; do curl -s http://localhost:8080/api/auth/otp/request -X POST -d '{"phone":"09123456789"}' -H "Content-Type: application/json" | head -1; done

# تست CORS
curl -H "Origin: https://evil.com" http://localhost:8080/api/health -v
```

**جزئیات کامل:** [SECURITY-HARDENING.md](./SECURITY-HARDENING.md)

---

## پردازش فارسی

### قابلیت‌ها

- **نرمال‌سازی:** ي→ی، ك→ک، حذف اعراب، یکسان‌سازی اعداد
- **توکن‌سازی:** hazm/parsivar با fallback regex
- **Stopwords:** ۱۰۰+ کلمه توقف فارسی + حقوقی
- **Stemming/Lemmatization:** ریشه‌یابی افعال فارسی
- **NER:** نام اشخاص، شهرهای ایران، دادگاه‌ها، تاریخ‌ها
- **اعداد:** تبدیل فارسی↔انگلیسی

### استفاده

```python
from pylegal.persian_tools import (
    normalize_persian,
    tokenize_persian,
    persian_digits_to_english,
    ner_persian,
)

text = "آقای محمد حسینی در تهران قرارداد اجاره را امضا کرد"
normalized = normalize_persian(text)
tokens = tokenize_persian(normalized)
entities = ner_persian(text)
# {"persons": [...], "cities": ["تهران"], "courts": [], ...}
```

### تست

```bash
cd apps/workers/py
PYTHONPATH=. python -m pytest tests/test_persian_tools.py -v
# 29 tests — همه باید پاس شوند
```

**جزئیات کامل:** [PERSIAN-NLP.md](./PERSIAN-NLP.md)

---

## ایجنت‌های حقوقی

### ۶ ایجنت

| ایجنت | حوزه | وضعیت |
|-------|------|-------|
| civil-expert | امور مدنی (قرارداد، ملک، خسارت، ارث) | ✅ واقعی |
| criminal-expert | امور کیفری (جرایم، مجازات، دادرسی) | ✅ واقعی |
| family-expert | امور خانواده | 🔶 ماک (قابل توسعه) |
| registration-expert | امور ثبتی | 🔶 ماک |
| international-expert | امور بین‌الملل | 🔶 ماک |
| legal-expert-base | پایه | 🔶 ماک |

### ایجنت‌های واقعی

#### Civil Expert (مدنی)

- تحلیل قرارداد: بندهای الزامی، مفقود، توصیه‌ها
- دعاوی: خسارت، الزام، فسخ، ابطال، خلع ید، ارث
- مواد قانونی: ۱۹۰، ۲۱۹، ۲۳۰، ۳۲۸، ۸۶۲ قانون مدنی

```typescript
const result = await civilExpert.executeExpert({
  taskId: '1',
  query: 'قرارداد اجاره آپارتمان با مبلغ ۱۰ میلیون',
});
// result.output شامل تحلیل کامل + citations
```

#### Criminal Expert (کیفری)

- جرایم: سرقت، کلاهبرداری، ضرب و جرح، قتل، خیانت در امانت، جعل، تهدید، افترا
- مجازات: درجات تعزیر، تخفیف، تعلیق، آزادی مشروط
- دادرسی: دادسرا، قرارهای تامین، دادگاه، تجدیدنظر

```typescript
const result = await criminalExpert.executeExpert({
  taskId: '2',
  query: 'اتهام کلاهبرداری و مجازات آن',
});
```

### تست

```bash
# تست ایجنت‌ها
npm test -- civil-expert.spec.ts
npm test -- criminal-expert.spec.ts
npm test -- agents-integration.spec.ts

# یا همه
npm run test --workspace=@legal-platform/agent-civil-expert
```

---

## عملیات روزمره

| کار | دستور |
|----|-------|
| روشن | `./scripts/start.sh` یا `docker compose up -d` |
| خاموش | `./scripts/stop.sh` یا `docker compose down` |
| تولید روشن | `docker compose -f docker-compose.prod.yml up -d` |
| لاگ API | `docker compose logs -f api` |
| لاگ همه | `docker compose logs -f` |
| وضعیت | `./scripts/diagnostics.sh` |
| سلامت | `curl -s http://localhost:8080/api/health \| jq` |
| متریک‌ها | `curl -s http://localhost:8080/api/metrics \| head -20` |
| داشبورد | مرورگر: `http://localhost:8080/api/health/dashboard` |
| بکاپ دستی | `./scripts/backup-prod.sh --type daily --encrypt --upload` |
| بازیابی | `./scripts/restore.sh --confirm backups/...tar.gz` |
| مانیتورینگ | `docker compose --profile monitoring up -d` |
| امنیت | `npm run security:secrets` |

### لاگ‌ها

```bash
# لاگ زنده
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f postgres

# لاگ با فیلتر
docker compose logs api | grep -i error
docker compose logs api | grep -i "otp\|auth"

# لاگ فایل (prod)
docker compose -f docker-compose.prod.yml logs --tail=100 api
ls -lh /var/log/legal-*.log
```

### فضای دیسک

```bash
# بررسی فضا
df -h
du -sh backups/* data/*

# پاکسازی لاگ‌های قدیمی (prod با json-file خودکار rotation دارد)
docker system prune -f
docker volume prune -f  # ⚠️ مراقب باشید — volumes را پاک می‌کند

# بکاپ‌های قدیمی (خودکار پاک می‌شوند با retention)
ls -lt backups/daily/ | tail -20
```

---

## به‌روزرسانی

### به‌روزرسانی کد

```bash
# 1. بکاپ قبل از آپدیت
./scripts/backup-prod.sh --type daily --encrypt --upload

# 2. دریافت کد جدید
git pull origin main

# 3. Build و restart
./scripts/update.sh
# یا
docker compose down
docker compose up -d --build

# برای prod
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --build

# 4. میگریشن (خودکار در setup.sh، ولی دستی هم می‌شود)
docker compose exec api npm run migrate:up

# 5. بررسی سلامت
./scripts/diagnostics.sh
curl -s http://localhost:8080/api/health | jq
```

### به‌روزرسانی بدون downtime (برای prod)

```bash
# Rolling update
docker compose -f docker-compose.prod.yml up -d --no-deps --build api
docker compose -f docker-compose.prod.yml up -d --no-deps --build worker
docker compose -f docker-compose.prod.yml up -d --no-deps --build web

# بررسی
docker compose -f docker-compose.prod.yml ps
curl -s http://localhost:8080/api/health | jq
```

### بازگشت به نسخه قبلی

```bash
# اگر آپدیت مشکل داشت
git checkout <previous-commit>
docker compose up -d --build

# یا بازیابی از بکاپ
./scripts/restore.sh --confirm backups/daily/backup-daily-XXXX.tar.gz
```

---

## بازیابی فاجعه

### سناریو ۱: دیتابیس خراب

```bash
# 1. بکاپ فعلی را نگه دارید (حتی اگر خراب)
./scripts/backup-prod.sh --type daily

# 2. لیست بکاپ‌های سالم
ls -lt backups/daily/ | head -10

# 3. بررسی checksum آخرین بکاپ سالم
sha256sum backups/daily/backup-daily-20240101-120000.tar.gz
cat backups/daily/manifest-20240101-120000.json | grep sha256

# 4. بازیابی
./scripts/restore.sh --confirm backups/daily/backup-daily-20240101-120000.tar.gz

# 5. بررسی
./scripts/diagnostics.sh
curl -s http://localhost:8080/api/health | jq
```

### سناریو ۲: سرور کامل از دست رفت

```bash
# روی سرور جدید

# 1. نصب از صفر
git clone <repo-url> legal-platform
cd legal-platform
sudo ./setup.sh

# 2. دریافت بکاپ از S3
aws s3 cp s3://legal-backups/daily/backup-daily-latest.tar.gz.enc ./backups/
# یا از MinIO
mc cp myminio/legal-backups/daily/backup-daily-latest.tar.gz.enc ./backups/

# 3. رمزگشایی
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in backups/backup-daily-latest.tar.gz.enc \
  -out /tmp/restore.tar.gz \
  -pass pass:"$BACKUP_ENCRYPTION_KEY"

# 4. بازیابی
./scripts/restore.sh --confirm /tmp/restore.tar.gz

# 5. تنظیمات دستی (provider_configs)
# از داشبورد: تنظیمات → پروایدرها → کلیدها را وارد کنید
```

### سناریو ۳: حذف تصادفی داده

```bash
# اگر داده‌ای حذف شد، سریع بکاپ نگیرید (بکاپ جدید داده حذف شده را دارد)

# 1. آخرین بکاپ قبل از حذف را پیدا کنید
ls -lt backups/daily/ | head -20
# بر اساس timestamp قبل از حذف انتخاب کنید

# 2. بکاپ را در محیط تست بازیابی کنید
# (روی سرور تست یا لوکال)
./scripts/restore.sh --confirm backups/daily/backup-daily-20240101-120000.tar.gz

# 3. داده مورد نظر را export کنید
# از طریق API یا psql

# 4. در تولید import کنید
```

### چک‌لیست بازیابی فاجعه

- [ ] بکاپ‌های روزانه، هفتگی، ماهانه موجود و سالم
- [ ] بکاپ‌ها در S3/MinIO آپلود می‌شوند (offsite)
- [ ] کلید رمزنگاری در جای امن (Vault) نگهداری می‌شود
- [ ] تست بازیابی ماهانه انجام شده
- [ ] مستندات بازیابی در دسترس تیم است
- [ ] اطلاعات تماس تیم DevOps موجود است
- [ ] Runbook چاپ شده یا در جای امن

---

## عیب‌یابی سریع

| علامت | دلیل محتمل | چه کنم |
|------|------------|--------|
| `curl /api/health` → 503 | DB هنوز بالا نیامده | `docker compose ps`، چند ثانیه صبر، `docker compose logs postgres` |
| `curl /api/ready` → 503 | Migration انجام نشده | `docker compose exec api npm run migrate:up` |
| `docker: permission denied` | کاربر در گروه docker نیست | `sudo usermod -aG docker $USER` سپس logout/login |
| OTP نمی‌رسد | کلید کاوه‌نگار ست نیست | در dev کد در لاگ است؛ برای prod کلید را در `.env` یا داشبورد قرار دهید |
| `port 8080 already in use` | سرویس دیگری روی ۸۰۸۰ | در `docker-compose.yml` پورت nginx را عوض کنید |
| بکاپ خراب | دیسک پر یا DB down | `df -h`، `docker compose logs postgres` |
| `BACKUP_ENCRYPTION_KEY not set` | کلید تنظیم نشده | در `.env` تنظیم کنید |
| `S3 upload failed` | مشکل S3 | بررسی `S3_BUCKET` و credentials |
| Rate limit 429 | درخواست زیاد | صبر کنید، یا `RATE_LIMIT` را چک کنید |
| CORS error | Origin غیرمجاز | `CORS_ORIGINS` و `APP_URL` را چک کنید |
| `disk space low` | دیسک پر | `docker system prune`، پاکسازی بکاپ‌های قدیمی |
| Agent خطا می‌دهد | AI provider down | `AI_PROVIDER` و `AI_API_KEY` را چک کنید، لاگ worker |
| `secret scan` یافته دارد | سکرت هاردکد شده | فایل را از git پاک کنید، از `.env` استفاده کنید |

### دستورات تشخیص

```bash
# وضعیت کلی
./scripts/diagnostics.sh

# سلامت
curl -s http://localhost:8080/api/health | jq
curl -s http://localhost:8080/api/ready | jq

# لاگ‌ها
docker compose logs --tail=100 api
docker compose logs --tail=100 postgres
docker compose logs --tail=100 redis
docker compose logs --tail=100 worker

# منابع
docker stats --no-stream
df -h
free -h

# شبکه
docker network ls
docker compose ps

# بکاپ
ls -lh backups/daily/ | tail -10
cat /var/log/legal-backup.log | tail -20

# امنیت
npm run security:secrets
curl -s -D - http://localhost:8080/api/health -o /dev/null | grep -i "x-frame\|hsts\|csp"
```

---

## امنیت فیلد (پیش از real-usage)

1. `.env` را با دسترسی `chmod 600` نگه دارید و هرگز در git قرار ندهید.
2. `POSTGRES_PASSWORD` را فقط بعد از نصب ببینید اگر لازم است دیباگ کنید — و هرگز commit نکنید.
3. همه سکرت‌ها را قوی و تصادفی تولید کنید (حداقل ۳۲ کاراکتر).
4. داشبورد ادمین را پشت فایروال/VPN محدود کنید، یا حداقل روی IP ثابت.
5. پس‌کی مالک را حداقل روی دو دستگاه ثبت کنید (بازیابی).
6. روزانه: `curl /api/health` cron + بکاپ شبانه + چک دستی یک‌بار بازیابی در هفته.
7. `npm run security:secrets` باید ۰ یافته باشد.
8. `CORS_ORIGINS` فقط دامنه‌های مجاز.
9. TLS/HTTPS فعال با HSTS.
10. مانیتورینگ و هشدار فعال (تلگرام/اسلک).

---

## منابع

- [BACKUP.md](./BACKUP.md) — راهنمای بکاپ تولید
- [MONITORING.md](./MONITORING.md) — مانیتورینگ و Prometheus
- [SECURITY-HARDENING.md](./SECURITY-HARDENING.md) — سخت‌سازی امنیتی
- [PERSIAN-NLP.md](./PERSIAN-NLP.md) — پردازش فارسی
- [SPEC.md](./SPEC.md) — مشخصات فنی
- [AGENT_FLEET.md](./AGENT_FLEET.md) — ایجنت‌های حقوقی

---

## پشتیبانی

- **لاگ‌ها:** `docker compose logs -f api`
- **سلامت:** `http://localhost:8080/api/health/dashboard`
- **متریک‌ها:** `http://localhost:8080/api/metrics`
- **ایمیل:** پشتیبانی فنی
- **تلگرام:** کانال هشدارها (در صورت تنظیم)

---

**نکته نهایی:** این Runbook را چاپ کنید و در جای امن نگه دارید. در زمان فاجعه، اینترنت ممکن است در دسترس نباشد.
