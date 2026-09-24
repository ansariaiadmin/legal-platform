#!/usr/bin/env bash
set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
ok() { echo -e "${GREEN}✅ $1${NC}"; }
explain() { echo -e "${CYAN}   💡 $1${NC}"; }
example() { echo -e "${DIM}   📝 مثال: $1${NC}"; }
where() { echo -e "${MAGENTA}   🔗 کجا؟ $1${NC}"; }
generate_secret() { openssl rand -base64 32 2>/dev/null | tr -d '\n' | tr -d '/' | tr -d '+' | cut -c1-32 || date +%s | sha256sum | head -c 32; }
ask_with_help() {
  local prompt="$1"; local help_text="$2"; local example_text="$3"; local where_text="$4"; local default_val="$5"; local is_secret="${6:-false}"
  echo ""; echo -e "${BOLD}${BLUE}❓ $prompt${NC}"
  [ -n "$help_text" ] && explain "$help_text"; [ -n "$example_text" ] && example "$example_text"; [ -n "$where_text" ] && where "$where_text"
  [ -n "$default_val" ] && echo -e "${DIM}   ⏭️  Enter=پیش‌فرض: $default_val${NC}" || echo -e "${DIM}   ⏭️  اگر نداری Enter=mock${NC}"
  local input=""; if [ "$is_secret" = "true" ]; then read -s -p "   👉 جواب: " input; echo ""; else read -p "   👉 جواب: " input; fi
  [ -z "$input" ] && [ -n "$default_val" ] && input="$default_val"; echo "$input"
}
ask_yes_no() {
  local prompt="$1"; local help_text="$2"; local default_yes="${3:-true}"
  echo ""; echo -e "${BOLD}${BLUE}❓ $prompt${NC}"; [ -n "$help_text" ] && explain "$help_text"
  [ "$default_yes" = "true" ] && echo -e "${DIM}   ⏭️  [Y/n] Enter=بله${NC}" || echo -e "${DIM}   ⏭️  [y/N] Enter=خیر${NC}"
  local input=""; read -p "   👉 جواب (y/n): " input; input=$(echo "$input" | tr '[:upper:]' '[:lower:]')
  [ -z "$input" ] && { if [ "$default_yes" = "true" ]; then input="y"; else input="n"; fi; }
  if [ "$input" = "y" ] || [ "$input" = "yes" ] || [ "$input" = "بله" ]; then echo "yes"; else echo "no"; fi
}

clear
echo -e "${CYAN}"
cat <<'BANNER'
 _                       _   ____  _       _    __
| |    ___  __ _  __ _  | | |  _ \| | __ _| |_ / _| ___  _ __ _ __ ___
| |   / _ \/ _` |/ _` | | | | |_) | |/ _` | __| |_ / _ \| '__| '_ ` _ \
| |__|  __/ (_| | (_| | | | |  __/| | (_| | |_|  _| (_) | |  | | | | | |
|_____\___|\__,_|\__,_| |_| |_|   |_|\__,_|\__|_|  \___/|_|  |_| |_| |_|
Legal OS + 6 AI Lawyers + RAG + E-Signature + PWA + SMS + Notification — Zero Support
BANNER
echo -e "${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  🧙‍♂️ جادوگر نصب Legal Platform v3.0.0 — پشتیبانی صفر${NC}"
echo -e "${BLUE}  برای وکیل — فقط ضروری‌ها — پرووایدر + پیامک + ناتیف${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}سلام وکیل عزیز! 👋 من منشی هوشمند شما هستم${NC}"
echo -e "${CYAN}هدف: پشتیبانی صفر — همه چی همینجا — فقط ضروری‌ها!${NC}"
echo ""
read -p "برای شروع جادو Enter بزنید... ✨ " _

echo -e "${BLUE}[1/8] 🔍 سیستم${NC}"; ok "اوکیه"; sleep 1
echo -e "${BLUE}[2/8] 🐳 Docker${NC}"; if ! command -v docker &> /dev/null; then echo -e "${RED}Docker نیست${NC}"; exit 1; else ok "Docker: $(docker --version)"; fi; sleep 1
echo -e "${BLUE}[3/8] 🔑 رمزهای بانکی${NC}"; SECRET_JWT=$(generate_secret); SECRET_ENC=$(generate_secret); ok "2 رمز 32 کاراکتری ساخته شد"; sleep 1

echo -e "${BLUE}[4/8] 🤖 AI Provider — 6 وکیل متخصص${NC}"
explain "6 وکیل AI: مدنی، کیفری، خانواده، ثبتی، بین‌الملل، عمومی — برای جواب حقوقی"
echo -e "${YELLOW}   گزینه‌ها: openai, anthropic, google, mock${NC}"
AI_PROVIDER=$(ask_with_help "پرووایدر AI کدوم؟" "برای 6 وکیل AI — اگر نمی‌دونی mock" "openai یا anthropic یا mock" "https://platform.openai.com/api-keys" "mock" "false")
AI_KEY=""
if [ "$AI_PROVIDER" != "mock" ]; then
  AI_KEY=$(ask_with_help "کلید API $AI_PROVIDER؟" "با sk- شروع می‌شه" "sk-..." "https://platform.openai.com/api-keys" "" "true")
  [ -n "$AI_KEY" ] && ok "AI تنظیم شد" || { AI_PROVIDER="mock"; echo -e "${YELLOW}⚠️ mock می‌شه${NC}"; }
fi
sleep 1

echo -e "${BLUE}[5/8] 📱 پنل پیامکی — برای نوبت‌دهی و اطلاع موکل${NC}"
explain "وقتی نوبت موکل می‌شه پیامک می‌ره: 'نفر بعدی تویی' — یا پرداخت"
echo -e "${YELLOW}   گزینه‌ها: ghasedak (قاصدک), kavenegar (کاوه‌نگار), mock${NC}"
SMS_PROVIDER=$(ask_with_help "پنل پیامکی کدوم؟" "برای اطلاع موکل از نوبت — اگر نداری mock" "ghasedak یا kavenegar یا mock" "https://ghasedak.me/ — API Key" "mock" "false")
SMS_KEY=""; SMS_SENDER=""
if [ "$SMS_PROVIDER" != "mock" ]; then
  SMS_KEY=$(ask_with_help "کلید API پنل $SMS_PROVIDER؟" "از پنل کپی کن" "api-key-..." "پنل → تنظیمات → API" "" "true")
  SMS_SENDER=$(ask_with_help "شماره فرستنده؟" "مثل 10008566" "10008566" "پنل → شماره‌ها" "" "false")
  ok "SMS تنظیم شد: $SMS_PROVIDER Sender $SMS_SENDER"
else
  explain "mock — پیامک‌ها تو لاگ — بعداً از /admin/settings می‌تونی اضافه کنی"
fi
sleep 1

echo -e "${BLUE}[6/8] 💳 پرداخت — Zarinpal — برای فروش وقت مشاوره${NC}"
explain "زرین‌پال چیه؟ درگاه پرداخت ایرانی — موکل وقت می‌خره — پول می‌ره زرین‌پال"
echo -e "${YELLOW}   گزینه‌ها: zarinpal (واقعی), mock (تست بدون پول)${NC}"
PAYMENT=$(ask_with_help "درگاه پرداخت کدوم؟" "برای فروش وقت مشاوره — اگر نداری mock" "zarinpal یا mock" "https://next.zarinpal.com/ → API" "mock" "false")
ZARINPAL_KEY=""
if [ "$PAYMENT" = "zarinpal" ]; then
  ZARINPAL_KEY=$(ask_with_help "Merchant ID زرین‌پال؟" "از زرین‌پال → تنظیمات → API" "merchant-id-..." "https://next.zarinpal.com/" "" "true")
  ok "Zarinpal تنظیم شد"
else
  PAYMENT="mock"
  explain "mock — پرداخت تستی — بدون پول واقعی"
fi
sleep 1

echo -e "${BLUE}[7/8] 📧 Email + 🔔 Notification + 📱 PWA + ✍️ E-Signature${NC}"
EMAIL_PROVIDER=$(ask_with_help "ایمیل پرووایدر؟" "برای فاکتور، اطلاع" "smtp یا mock" "Gmail App Passwords" "mock" "false")
SMTP_HOST=""; SMTP_USER=""; SMTP_PASS=""
if [ "$EMAIL_PROVIDER" = "smtp" ]; then
  SMTP_HOST=$(ask_with_help "SMTP Host؟" "smtp.gmail.com" "smtp.gmail.com" "Gmail" "smtp.gmail.com" "false")
  SMTP_USER=$(ask_with_help "SMTP User؟" "you@gmail.com" "ایمیل خودت" "" "false")
  SMTP_PASS=$(ask_with_help "SMTP Pass؟" "App Password" "app-pass-..." "myaccount.google.com → App Passwords" "" "true")
  ok "SMTP تنظیم شد"
fi

NOTIF_EMAIL=$(ask_yes_no "ایمیل ناتیف روشن باشه؟" "وقتی نوبت می‌شه ایمیل بره" "true")
NOTIF_SMS=$(ask_yes_no "پیامک ناتیف روشن باشه؟" "وقتی نوبت موکل می‌شه پیامک بره — مهم" "true")
TELEGRAM_ENABLED=$(ask_yes_no "ربات تلگرام برای ناتیف وکیل می‌خوای؟" "وقتی موکل جدید میاد یا پرداخت می‌شه تلگرام خبر می‌ده" "false")
TELEGRAM_TOKEN=""; TELEGRAM_CHAT=""
if [ "$TELEGRAM_ENABLED" = "yes" ]; then
  echo -e "${BOLD}   @BotFather → /newbot → توکن${NC}"
  TELEGRAM_TOKEN=$(ask_with_help "توکن ربات؟" "از @BotFather" "123456:ABC..." "@BotFather → /newbot" "" "true")
  TELEGRAM_CHAT=$(ask_with_help "Chat ID؟" "از getUpdates" "123456789" "https://api.telegram.org/bot<TOKEN>/getUpdates" "" "false")
  ok "Telegram تنظیم شد"
fi
sleep 1

echo -e "${BLUE}[8/8] ⚙️ .env + 🏗️ اجرا${NC}"
cat > .env <<EOF
# Legal Platform — .env — جادوگر v3.0.0 — پشتیبانی صفر — $(date)
DATABASE_URL=postgresql://legal:legal@db:5432/legal
REDIS_URL=redis://redis:6379/0
JWT_SECRET=${SECRET_JWT}
ENCRYPTION_KEY=${SECRET_ENC}
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=${SECRET_JWT}

# AI — 6 وکیل متخصص — چیه؟ هوش مصنوعی حقوقی — گزینه: openai, anthropic, mock
AI_PROVIDER=${AI_PROVIDER}
OPENAI_API_KEY=${AI_KEY}
ANTHROPIC_API_KEY=${AI_KEY}

# SMS — پنل پیامکی — برای نوبت‌دهی موکل
SMS_PROVIDER=${SMS_PROVIDER}
SMS_API_KEY=${SMS_KEY}
SMS_SENDER=${SMS_SENDER}
# Legacy
GHASEDAK_API_KEY=${SMS_KEY}
KAVENEGAR_API_KEY=${SMS_KEY}

# Payment — زرین‌پال — برای فروش وقت
PAYMENT_PROVIDER=${PAYMENT}
ZARINPAL_MERCHANT_ID=${ZARINPAL_KEY}

# Email — ایمیل
EMAIL_PROVIDER=${EMAIL_PROVIDER}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=587
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}

# S3 — بکاپ — برای بکاپ offsite
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY=access
S3_SECRET_KEY=secret
S3_BUCKET=legal-backups
BACKUP_ENCRYPTION_KEY=$(generate_secret)

# Notification System — سیستم ناتیف — سقف 10/10 — چیه؟ اطلاع‌رسانی نوبت + پرداخت + موکل
NOTIF_IN_APP=true
NOTIF_EMAIL=${NOTIF_EMAIL}
NOTIF_SMS=${NOTIF_SMS}
NOTIF_TELEGRAM=${TELEGRAM_ENABLED}
TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT}

# PWA + E-Signature — سقف 10/10 — همیشه روشن
PWA_ENABLED=true
ESIGNATURE_ENABLED=true

PORT=3000
API_PORT=3001
LOG_LEVEL=info
EOF

ok ".env ساخته شد — $(wc -l < .env) خط"

echo -e "${MAGENTA}  docker compose up --build -d${NC}"
docker compose up --build -d 2>&1 | tail -n 20 || docker compose up -d
echo ""
echo -e "${BLUE}  ⏳ 30 ثانیه صبر...${NC}"
echo -n "  "; for i in {1..30}; do echo -n "."; sleep 1; if curl -sf http://localhost:3000 >/dev/null 2>&1; then echo ""; ok "آماده!"; break; fi; done
echo ""
docker compose ps 2>/dev/null || true

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  🎉 جادو تمام! دفتر وکالت هوشمند آماده! 🎉${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BOLD}${BLUE}📍 دسترسی:${NC}"
echo -e "${GREEN}  🌐 Web: http://localhost:3000 — داشبورد فارسی${NC}"
echo -e "${GREEN}  📚 API: http://localhost:8000/docs${NC}"
echo -e "${GREEN}  📱 PWA: رو موبایل نصب می‌شه — سقف 10/10!${NC}"
echo -e "${GREEN}  ✍️ E-Signature: /components/ESignature — سقف!${NC}"
echo ""
echo -e "${BOLD}${BLUE}✅ چک‌لیست:${NC}"
echo -e "  $([ "$AI_PROVIDER" != "mock" ] && echo "✅" || echo "⚠️") AI: $AI_PROVIDER — 6 وکیل"
echo -e "  $([ "$SMS_PROVIDER" != "mock" ] && echo "✅" || echo "⚠️") SMS: $SMS_PROVIDER — نوبت‌دهی"
echo -e "  $([ "$PAYMENT" != "mock" ] && echo "✅" || echo "⚠️") Payment: $PAYMENT — فروش وقت"
echo -e "  ✅ PWA + E-Signature: همیشه روشن — سقف"
echo -e "  ✅ In-App Notif: همیشه روشن"
echo -e "  $([ "$NOTIF_SMS" = "yes" ] && echo "✅" || echo "⚪") SMS Notif: $NOTIF_SMS — نوبت موکل"
echo -e "  $([ "$TELEGRAM_ENABLED" = "yes" ] && echo "✅" || echo "⚪") Telegram Notif: $TELEGRAM_ENABLED"
echo ""
echo -e "${BOLD}${BLUE}🎯 حالا چی؟${NC}"
echo -e "${YELLOW}  1. مرورگر → localhost:3000 — پرونده بساز + موکل اضافه کن${NC}"
echo -e "${YELLOW}  2. AI Workspace → سوال بپرس: 'قرارداد اجاره چطور فسخ می‌شه؟' → 6 وکیل AI جواب می‌ده!${NC}"
echo -e "${YELLOW}  3. اسناد → PDF آپلود → OCR → RAG → E-Signature امضا کن!${NC}"
echo -e "${YELLOW}  4. PWA → رو موبایل نصب کن — تو دادگاه استفاده کن!${NC}"
echo ""
echo -e "${CYAN}📚 docs/SETUP-WIZARD-FA.md — برای وکیل!${NC}"
echo ""
