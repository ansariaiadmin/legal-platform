# 📦 راهنمای سیستم بکاپ حرفه‌ای

این سند راهنمای کامل سیستم بکاپ تولید (Production Backup System) برای پلتفرم حقوقی است.

---

## فهرست مطالب

1. [معماری بکاپ](#معماری-بکاپ)
2. [انواع بکاپ](#انواع-بکاپ)
3. [نحوه استفاده](#نحوه-استفاده)
4. [رمزنگاری](#رمزنگاری)
5. [آپلود به S3/MinIO](#آپلود-به-s3minio)
6. [سیاست نگهداری](#سیاست-نگهداری)
7. [بازیابی](#بازیابی)
8. [کرون جاب‌ها](#کرون-جابها)
9. [عیب‌یابی](#عیب‌یابی)

---

## معماری بکاپ

سیستم بکاپ تولید شامل ۴ بخش اصلی است:

```
┌─────────────────────────────────────────────────────────┐
│  PostgreSQL Dump (pg_dump custom format + compress)     │
│  - شامل همه جداول به جز provider_configs (حساس)         │
│  - فرمت custom برای بازیابی سریع                         │
│  - فشرده‌سازی خودکار                                     │
├─────────────────────────────────────────────────────────┤
│  File Storage Backup (uploads, documents)               │
│  - آرشیو tar.gz از پوشه uploads                         │
│  - حفظ ساختار پوشه‌ها                                   │
├─────────────────────────────────────────────────────────┤
│  Redis Dump (اختیاری)                                   │
│  - dump.rdb از Redis                                    │
│  - برای محیط‌های با REDIS_URL                            │
├─────────────────────────────────────────────────────────┤
│  Manifest JSON                                          │
│  - checksum SHA256 برای هر بخش                          │
│  - metadata کامل بکاپ                                   │
│  - اطلاعات retention و نسخه                              │
└─────────────────────────────────────────────────────────┘
```

### فایل‌های تولید شده

- `backup-{type}-{timestamp}.tar.gz` — آرشیو نهایی
- `backup-{type}-{timestamp}.tar.gz.enc` — نسخه رمزنگاری شده (در صورت فعال بودن)
- `manifest-{timestamp}.json` — اطلاعات و checksum

---

## انواع بکاپ

### روزانه (Daily)

- **فرکانس:** هر روز ساعت ۳ صبح
- **نگهداری:** ۷ نسخه آخر
- **محتوا:** بکاپ کامل دیتابیس + فایل‌ها + Redis
- **کاربرد:** بازیابی سریع تا ۱ هفته گذشته

### هفتگی (Weekly)

- **فرکانس:** یکشنبه‌ها ساعت ۲ صبح
- **نگهداری:** ۴ نسخه آخر (۱ ماه)
- **محتوا:** بکاپ کامل
- **کاربرد:** بازیابی تا ۱ ماه گذشته، قبل از آپدیت‌های مهم

### ماهانه (Monthly)

- **فرکانس:** روز اول هر ماه ساعت ۱ صبح
- **نگهداری:** ۱۲ نسخه آخر (۱ سال)
- **محتوا:** بکاپ کامل + آرشیو بلندمدت
- **کاربرد:** آرشیو قانونی، حسابرسی، بازیابی بلندمدت

---

## نحوه استفاده

### بکاپ دستی

```bash
# بکاپ روزانه ساده
./scripts/backup-prod.sh --type daily

# بکاپ روزانه با رمزنگاری
BACKUP_ENCRYPTION_KEY="your-strong-key-32chars" ./scripts/backup-prod.sh --type daily --encrypt

# بکاپ هفتگی با رمزنگاری و آپلود به S3
BACKUP_ENCRYPTION_KEY="..." S3_BUCKET="legal-backups" ./scripts/backup-prod.sh --type weekly --encrypt --upload

# بکاپ ماهانه کامل
./scripts/backup-prod.sh --type monthly --encrypt --upload
```

### پارامترها

| پارامتر | توضیح | پیش‌فرض |
|---------|-------|---------|
| `--type` | نوع بکاپ: daily, weekly, monthly | daily |
| `--encrypt` | فعال‌سازی رمزنگاری AES-256 | غیرفعال |
| `--upload` | آپلود به S3/MinIO | غیرفعال |
| `--help` | نمایش راهنما | - |

### متغیرهای محیطی

```bash
# الزامی برای رمزنگاری
BACKUP_ENCRYPTION_KEY="کلید-قوی-۳۲-کاراکتری-یا-بیشتر"

# اختیاری برای S3
S3_BUCKET="legal-platform-backups"
S3_ENDPOINT="https://s3.example.com"  # برای MinIO
S3_REGION="us-east-1"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."

# تنظیمات نگهداری
BACKUP_RETAIN_DAYS=30  # برای بکاپ‌های قدیمی در پوشه اصلی
```

---

## رمزنگاری

### الگوریتم

- **الگوریتم:** AES-256-CBC
- **مشتق کلید:** PBKDF2 با salt تصادفی
- **ابزار:** OpenSSL

### نحوه کار

```bash
# رمزنگاری
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in backup-daily-20240101-120000.tar.gz \
  -out backup-daily-20240101-120000.tar.gz.enc \
  -pass pass:"$BACKUP_ENCRYPTION_KEY"

# رمزگشایی
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in backup-daily-20240101-120000.tar.gz.enc \
  -out backup-daily-20240101-120000.tar.gz \
  -pass pass:"$BACKUP_ENCRYPTION_KEY"
```

### نکات امنیتی

- کلید رمزنگاری را در جای امن نگهداری کنید (Vault، 1Password)
- هرگز کلید را در git commit نکنید
- از کلید قوی (حداقل ۳۲ کاراکتر تصادفی) استفاده کنید
- کلید را در `.env` با `chmod 600` نگهداری کنید

---

## آپلود به S3/MinIO

### AWS S3

```bash
# نصب AWS CLI
pip install awscli

# تنظیم credentials
aws configure

# بکاپ با آپلود خودکار
S3_BUCKET="my-legal-backups" ./scripts/backup-prod.sh --type daily --encrypt --upload
```

### MinIO خودمیزبان

```bash
# نصب MinIO client
curl https://dl.min.io/client/mc/release/linux-amd64/mc -o mc
chmod +x mc

# تنظیم alias
./mc alias set myminio https://minio.example.com ACCESS_KEY SECRET_KEY

# بکاپ با MinIO
S3_BUCKET="legal-backups" S3_ENDPOINT="https://minio.example.com" ./scripts/backup-prod.sh --type daily --upload
```

### ساختار S3

```
s3://legal-backups/
├── daily/
│   ├── backup-daily-20240101-120000.tar.gz.enc
│   ├── backup-daily-20240102-120000.tar.gz.enc
│   └── manifest-20240101-120000.json
├── weekly/
│   ├── backup-weekly-20240107-020000.tar.gz.enc
│   └── manifest-20240107-020000.json
└── monthly/
    ├── backup-monthly-20240101-010000.tar.gz.enc
    └── manifest-20240101-010000.json
```

---

## سیاست نگهداری

### قانون ۷-۴-۱۲

- **۷ روزانه:** ۷ بکاپ آخر روزانه (۱ هفته)
- **۴ هفتگی:** ۴ بکاپ آخر هفتگی (۱ ماه)
- **۱۲ ماهانه:** ۱۲ بکاپ آخر ماهانه (۱ سال)

### نحوه اجرا

```bash
# اسکریپت به صورت خودکار قدیمی‌ها را پاک می‌کند
# فقط N نسخه جدید را نگه می‌دارد

# مثال: اگر ۱۰ بکاپ روزانه دارید و RETENTION_DAILY=7
# ۳ بکاپ قدیمی پاک می‌شود
```

### فضای دیسک

- هر بکاپ کامل: حدود ۱۰۰MB تا ۱GB (بسته به حجم دیتابیس و فایل‌ها)
- با فشرده‌سازی: ۳۰-۵۰% کاهش حجم
- با رمزنگاری: ۱-۲% افزایش حجم
- تخمین ماهانه: ۷×۱GB + ۴×۱GB + ۱×۱GB = حدود ۱۲GB

---

## بازیابی

### بازیابی کامل

```bash
# لیست بکاپ‌ها
ls -lh backups/daily/ backups/weekly/ backups/monthly/

# بازیابی (نیاز به تایید صریح)
./scripts/restore.sh --confirm backups/daily/backup-daily-20240101-120000.tar.gz

# بازیابی از نسخه رمزنگاری شده
# ابتدا رمزگشایی
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in backups/daily/backup-daily-20240101-120000.tar.gz.enc \
  -out /tmp/restore.tar.gz \
  -pass pass:"$BACKUP_ENCRYPTION_KEY"

# سپس بازیابی
./scripts/restore.sh --confirm /tmp/restore.tar.gz
```

### بازیابی جزئی

```bash
# استخراج فقط manifest برای بررسی
tar -tzf backups/daily/backup-daily-20240101-120000.tar.gz

# استخراج فقط دیتابیس
tar -xzf backups/daily/backup-daily-20240101-120000.tar.gz db-*.dump

# بازیابی فقط دیتابیس
pg_restore -h localhost -U legal -d legal_platform --clean --if-exists db-20240101-120000.dump
```

### تست بازیابی

```bash
# تست خودکار (بدون اعمال تغییرات)
./scripts/restore.sh --test backups/daily/backup-daily-20240101-120000.tar.gz

# بررسی checksum
sha256sum backups/daily/backup-daily-20240101-120000.tar.gz
cat backups/daily/manifest-*.json | grep sha256
```

### نکات بازیابی

- همیشه قبل از بازیابی، بکاپ جدید بگیرید
- سرویس‌های api و worker به صورت خودکار stop می‌شوند
- provider_configs بازیابی نمی‌شود (باید دستی تنظیم شود)
- پس از بازیابی، `diagnostics.sh` را اجرا کنید

---

## کرون جاب‌ها

### تنظیم کرون

```bash
crontab -e
```

### نمونه کرون‌ها

```cron
# روزانه ساعت 3 صبح
0 3 * * * /path/to/legal-platform/scripts/backup-prod.sh --type daily --encrypt --upload >> /var/log/legal-backup.log 2>&1

# هفتگی یکشنبه ساعت 2 صبح
0 2 * * 0 /path/to/legal-platform/scripts/backup-prod.sh --type weekly --encrypt --upload >> /var/log/legal-backup.log 2>&1

# ماهانه روز اول ساعت 1 صبح
0 1 1 * * /path/to/legal-platform/scripts/backup-prod.sh --type monthly --encrypt --upload >> /var/log/legal-backup.log 2>&1

# بررسی سلامت بکاپ‌ها هر روز ساعت 6 صبح
0 6 * * * /path/to/legal-platform/scripts/diagnostics.sh >> /var/log/legal-diagnostics.log 2>&1
```

### مانیتورینگ کرون

```bash
# بررسی لاگ
tail -f /var/log/legal-backup.log

# بررسی آخرین بکاپ
ls -lt backups/daily/ | head -5

# بررسی کرون
crontab -l
```

---

## عیب‌یابی

| مشکل | دلیل | راه حل |
|------|------|--------|
| `pg_dump failed` | اتصال به دیتابیس | بررسی DATABASE_URL و POSTGRES_PASSWORD |
| `BACKUP_ENCRYPTION_KEY not set` | کلید رمزنگاری تنظیم نشده | تنظیم متغیر محیطی |
| `S3 upload failed` | مشکل S3 | بررسی S3_BUCKET و credentials |
| `No space left` | دیسک پر | پاکسازی بکاپ‌های قدیمی، افزایش دیسک |
| `checksum mismatch` | بکاپ خراب | بکاپ دیگری را امتحان کنید |

### دستورات مفید

```bash
# بررسی فضای دیسک
df -h
du -sh backups/*

# تست اتصال دیتابیس
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U legal -d legal_platform -c "SELECT 1"

# تست رمزنگاری
echo "test" | openssl enc -aes-256-cbc -pbkdf2 -pass pass:"testkey" | openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"testkey"

# بررسی S3
aws s3 ls s3://legal-backups/daily/ --endpoint-url https://minio.example.com
```

---

## چک‌لیست تولید

- [ ] کرون جاب‌های روزانه، هفتگی، ماهانه تنظیم شده
- [ ] رمزنگاری فعال با کلید قوی
- [ ] آپلود به S3/MinIO فعال
- [ ] تست بازیابی انجام شده (حداقل ماهی یک بار)
- [ ] مانیتورینگ دیسک فعال
- [ ] لاگ بکاپ‌ها بررسی می‌شود
- [ ] کلید رمزنگاری در جای امن نگهداری می‌شود
- [ ] مستندات بازیابی در دسترس تیم است

---

## پشتیبانی

در صورت مشکل:

1. لاگ‌ها را بررسی کنید: `/var/log/legal-backup.log`
2. `diagnostics.sh` را اجرا کنید
3. با تیم DevOps تماس بگیرید
4. مستندات RUNBOOK.md را ببینید
