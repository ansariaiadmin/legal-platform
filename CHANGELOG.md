## [v1.0.1] - 2026-09-24 - Non-Technical Auto Install + Auto Update Edition

### Added - نصب خودکار برای افراد غیر فنی
- **install.sh**: نصب خودکار تمیز - چک Docker, ساخت .env با رمز تصادفی openssl, docker compose up --build -d, صبر 30s, سلامت چک, نمایش آدرس و رمز ورود
- **update.sh**: آپدیت خودکار - بکاپ به backups/YYYYMMDD-HHMMSS/, git pull origin main, docker compose pull + up --build -d, health check, rollback hint
- **start.sh, stop.sh, status.sh, logs.sh, backup.sh**: دستورات ساده روزانه
- **install.bat, start.bat, stop.bat, status.bat, logs.bat, update.bat, backup.bat**: نسخه ویندوز برای افراد غیر فنی
- **INSTALL.md**: راهنمای کامل فارسی نصب در 3 قدم (<5 دقیقه)
- **docs/USER_GUIDE_FA.md**: آموزش کامل تمام بخش‌ها - داشبورد, تنظیمات .env, Docker چیست, بکاپ, عیب‌یابی, امنیت, ورژن‌ها
- **docs/USER_GUIDE_EN.md**: Full English guide for non-technical
- **README**: بخش جدید "برای افراد غیر فنی / For Non-Technical Users — نصب در 1 دقیقه!" با one-liner

### Fixed
- Clean presentation: حذف cache artifacts, .env فقط .env.example
- Non-technical UX: پیام‌های فارسی + انگلیسی، رنگی، راهنمای قدم به قدم

### Docs
- README badge+mermaid+quickstart+sample output + non-technical section
- INSTALL.md + docs/USER_GUIDE_FA.md + docs/USER_GUIDE_EN.md

# Changelog — legal-platform

## [1.0.0] - 2026-09-24

### Added
- 67 test suites, 476 tests passed, 0 failed (previously 2 pre-existing failures fixed)
- Orchestrator: deterministic-first routing, hybrid inference router, intent classifier, fleet routing, config hub, evolution, metrics + evaluator
- Legal experts: civil, criminal, family, base with grounding, corpus ingestion, collector worker, budget hard-stop
- Security: JWT + refresh, roles guard, rate-limit, egress, stream ticket, phone normalization
- Ops: backup-restore parsers (URI + keyword form), installer one-click, docker prod, local storage, diagnostics, migrations
- Billing: pg-wallet, wallet topup contract, payment provider contracts
- Providers: tenant-scoped storage, factory, contracts (ai, payment, sms, telephony, push)
- Frontend: Next.js dashboard, wizard, governance + voice
- CI: lint + typecheck + jest + build + docker
- Docs: README badge+mermaid+quickstart+sample output, ROADMAP Done vs v2, AGENTS, HANDOFF

### Fixed
- backup-restore-parsers: whitespace escaping fixed (credential priority law, url_decode)
- installer-one-click: .env.example path fixed at root, secret rotation, POSTGRES_PASSWORD + DATABASE_URL sync law, docker-compose no hard-coded password
- jest open handles: fixed async ops not stopped, all suites pass without --detectOpenHandles warning
- e2e orchestrator config: config-hub + intent classifier + fleet routing

### Security
- Secret scan 0 real (1 intentional test token sk-XyZ... in config-intent.spec.ts masked)
- .env.example complete per REPORT-7-FINAL: DATABASE_URL, REDIS_URL, JWT_SECRET, LOCAL_LLM_URL, CLOUD_LLM_KEY optional, NODE_ENV
- No private key, RLS + encryption

## [0.9.0] - 2026-09-07
- Previous release with 474 passed, 2 failed (backup-restore-parsers whitespace, installer .env.example)
