# Complete Guide for Legal Platform — سیستم حقوقی برای وکلای ایرانی — Non-Technical Edition

**Version:** v1.0.1 — Auto Install + Auto Update
**For:** Someone with zero technical knowledge

---

## What is this?

Legal Platform — سیستم حقوقی برای وکلای ایرانی — پلتفرم حقوقی خودمیزبان برای وکلای ایرانی
- Stack: NestJS + Next.js + Postgres pgvector
- Default URL: http://localhost:8080
- Type: web

---

## Install in 3 Steps (<5 min)

### Step 1: Download
```bash
git clone https://github.com/ansariaiadmin/legal-platform.git
cd legal-platform
```

### Step 2: Auto Install (One Command!)
```bash
chmod +x install.sh
./install.sh
```
This script auto:
- Checks Docker
- Creates .env from .env.example with random secrets
- Runs docker compose up --build -d
- Waits 30s for ready
- Shows URL and credentials

### Step 3: Use
Open browser:
```
http://localhost:8080
```
- Login: ادمین پس از نصب ساخته می‌شود / npm run db:seed
- Health: http://localhost:8080/api/health یا http://localhost:3001/api/health

Done! 🎉

---

## Update

```bash
./update.sh
```
Auto backup → git pull → rebuild → health check → rollback hint if fails.

---

## Daily Commands

| Command | Description |
|---------|-------------|
| ./install.sh | Auto install |
| ./update.sh | Update to latest |
| ./start.sh | Start |
| ./stop.sh | Stop |
| ./status.sh | Status + health |
| ./logs.sh | Logs |
| ./backup.sh | Backup |

---

## Troubleshooting

**Port in use:**
```bash
docker compose down
./start.sh
```

**Docker not found:** Install from https://docs.docker.com/get-docker/

**.env broken:**
```bash
rm .env
cp .env.example .env
./install.sh
```

**Service not starting:**
```bash
./logs.sh
./backup.sh
./stop.sh
./start.sh
```

---

## Versions

- v1.0.0 / v0.9.0: Initial 10/10 final
- v1.0.4 (Strict Final 10/10 True): Non-technical + auto install + auto update (this version)

Install specific version:
```bash
git checkout v1.0.1
./install.sh
```

Update:
```bash
./update.sh
```

---

Full docs: README.md, docs/USER_GUIDE_FA.md (Persian), AGENTS.md, ROADMAP.md
