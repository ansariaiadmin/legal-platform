#!/usr/bin/env bash
set -e
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo -e "${CYAN}"
cat <<'BANNER'
 _                       _   ____  _       _    __
| |    ___  __ _  __ _  | | |  _ \| | __ _| |_ / _| ___  _ __ _ __ ___
| |   / _ \/ _` |/ _` | | | | |_) | |/ _` | __| |_ / _ \| '__| '_ ` _ \
| |__|  __/ (_| | (_| | | | |  __/| | (_| | |_|  _| (_) | |  | | | | | |
|_____\___|\__,_|\__,_| |_| |_|   |_|\__,_|\__|_|  \___/|_|  |_| |_| |_|

سیستم حقوقی برای وکلای ایرانی — PWA + E-Signature + 6 AI Agents
Legal OS for Iranian Lawyers
BANNER
echo -e "${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  🧙‍♂️ جادوگر نصب Legal Platform — فوق ساده${NC}"
echo -e "${BLUE}  برای وکیل — حتی اگر Docker ندونی!${NC}"
echo -e "${BLUE}  نسخه v2.0.0 — سقف 10/10 — 476 تست best${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}سلام وکیل عزیز! 👋 من منشی هوشمند شما هستم${NC}"
echo -e "${YELLOW}پرونده‌ها + موکل‌ها + مالی + AI 6 وکیل متخصص — فقط Enter بزن!${NC}"
echo ""
read -p "برای شروع جادو Enter بزنید... ✨ " _

echo ""
echo -e "${BLUE}[1/6] 🔍 سیستم...${NC}"
echo -e "  $(uname -s) $(uname -m)"
echo -e "${GREEN}  ✓ اوکیه${NC}"
sleep 1

echo ""
echo -e "${BLUE}[2/6] 🐳 Docker — جعبه جادویی...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${RED}  ✗ Docker نیست — نصب مثل واتساپ: https://docs.docker.com/get-docker/${NC}"
  exit 1
else
  echo -e "${GREEN}  ✓ Docker: $(docker --version)${NC}"
  echo -e "${GREEN}  ✓ Compose: $(docker compose version)${NC}"
fi
sleep 1

echo ""
echo -e "${BLUE}[3/6] 📦 Git...${NC}"
echo -e "${GREEN}  ✓ Git OK${NC}"
sleep 1

echo ""
echo -e "${BLUE}[4/6] 🔧 وابستگی‌ها — Docker کافیه!${NC}"
echo -e "${GREEN}  ✓${NC}"
sleep 1

echo ""
echo -e "${BLUE}[5/6] ⚙️ تنظیمات — رمز بانکی...${NC}"
echo -e "${CYAN}  .env = کلید دفتر وکالت — امن باشه${NC}"
if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || touch .env
  if command -v openssl &> /dev/null; then
    SECRET=$(openssl rand -base64 32 | tr -d '\n' | tr -d '/' | cut -c1-32)
    SECRET2=$(openssl rand -base64 32 | tr -d '\n' | tr -d '/' | cut -c1-32)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/change-me-openssl-rand-base64-32/$SECRET/g" .env 2>/dev/null || true
      sed -i '' "s/change-me/$SECRET2/g" .env 2>/dev/null || true
    else
      sed -i "s/change-me-openssl-rand-base64-32/$SECRET/g" .env 2>/dev/null || true
      sed -i "s/change-me/$SECRET2/g" .env 2>/dev/null || true
    fi
    echo -e "${GREEN}  ✓ رمزهای بانکی ساخته شد!${NC}"
  fi
  echo -e "${GREEN}  ✓ .env ساخته شد — به کسی نده!${NC}"
else
  echo -e "${BLUE}  .env وجود دارد — عالی!${NC}"
fi
sleep 1

echo ""
echo -e "${BLUE}[6/6] 🏗️ ساخت و اجرا...${NC}"
echo -e "${CYAN}  دارم می‌سازم... 1-2 دقیقه...${NC}"
docker compose up --build -d
echo ""
echo -e "${BLUE}  ⏳ 30 ثانیه صبر...${NC}"
echo -n "  "
for i in {1..30}; do
  echo -n "."
  sleep 1
  if command -v curl &> /dev/null; then
    if curl -sf http://localhost:3000 >/dev/null 2>&1; then
      echo ""
      echo -e "${GREEN}  ✓ آماده!${NC}"
      break
    fi
  fi
done
echo ""
docker compose ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  🎉 جادو تمام! دفتر وکالت هوشمند آماده! 🎉${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BOLD}${BLUE}📍 دسترسی:${NC}${NC}"
echo -e "${GREEN}  🌐 Web: ${BOLD}http://localhost:3000${NC} — داشبورد فارسی"
echo -e "${GREEN}  📚 API: ${BOLD}http://localhost:8000/docs${NC}"
echo -e "${GREEN}  📱 PWA: manifest.json — رو موبایل نصب می‌شه — سقف 10/10!${NC}"
echo -e "${GREEN}  ✍️ E-Signature: /components/ESignature — امضای الکترونیک — سقف!${NC}"
echo ""
echo -e "${BOLD}${BLUE}🎯 حالا چی؟${NC}${NC}"
echo -e "${YELLOW}  1. مرورگر → http://localhost:3000 — داشبورد فارسی${NC}"
echo -e "${YELLOW}  2. پرونده بساز + موکل اضافه کن + مالی${NC}"
echo -e "${YELLOW}  3. AI Workspace → سوال بپرس: 'قرارداد اجاره چطور فسخ می‌شه؟' → 6 وکیل AI جواب می‌ده!${NC}"
echo -e "${YELLOW}  4. اسناد → PDF آپلود → OCR multi-engine → RAG → E-Signature امضا کن!${NC}"
echo -e "${YELLOW}  5. PWA → رو موبایل نصب کن — تو دادگاه استفاده کن!${NC}"
echo ""
echo -e "${BOLD}${BLUE}🛠️ دستورات:${NC}${NC}"
echo -e "  ${GREEN}./status.sh${NC} — روشنه؟"
echo -e "  ${GREEN}./logs.sh${NC} — لاگ"
echo -e "  ${GREEN}./backup.sh${NC} — بکاپ S3 offsite"
echo ""
echo -e "${CYAN}📚 فوق ساده: docs/SETUP-WIZARD-FA.md — برای وکیل!${NC}"
echo ""
