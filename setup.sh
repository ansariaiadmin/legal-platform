#!/usr/bin/env bash
#
# ╔══════════════════════════════════════════════════════════════════╗
# ║   پلتفرم حقوقی (Legal Platform) — نصب با یک دستور (Ubuntu 22.04+)  ║
# ╚══════════════════════════════════════════════════════════════════╝
#
#   اجرا:        sudo ./setup.sh
#   فقط-چک:     sudo ./setup.sh --check
#
# It validates the host, installs Docker if missing, generates all secrets,
# builds & starts the stack, runs migrations, and waits until healthy.
# On success it prints the dashboard and client-portal URLs.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
c_red()   { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
c_dim()   { printf '\033[0;36m%s\033[0m\n' "$*"; }

banner() {
  echo ""
  c_green "┌────────────────────────────────────────────┐"
  c_green "│        پلتفرم حقوقی — نصب خودکار           │"
  c_green "└────────────────────────────────────────────┘"
  echo ""
}

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

banner

# ── Step 0: housekeeping ──────────────────────────────────────────────
if [[ $EUID -ne 0 && $CHECK_ONLY -eq 0 ]]; then
  c_dim "نکته: نصب کامل به sudo نیاز دارد — در حال ارتقاء به root…"
  exec sudo -E bash "$SCRIPT_DIR/setup.sh" "$@"
fi

# ── Step 1: delegate to the hardened installer ───────────────────────
if [[ ! -x "$SCRIPT_DIR/scripts/install.sh" ]]; then
  chmod +x "$SCRIPT_DIR"/scripts/*.sh 2>/dev/null || true
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  bash -n "$SCRIPT_DIR"/scripts/*.sh && c_green "✔ همهٔ اسکریپت‌ها از نظر syntax سالم‌اند"
  [[ -f "$SCRIPT_DIR/.env.example" ]] && c_green "✔ .env.example موجود است"
  [[ -f "$SCRIPT_DIR/docker-compose.yml" ]] && c_green "✔ docker-compose.yml موجود است"
  exit 0
fi

bash "$SCRIPT_DIR/scripts/install.sh"

# ── Step 2: wizard hand-off ──────────────────────────────────────────
echo ""
c_green "┌────────────────────────────────────────────┐"
c_green "│            نصب کامل شد! 🎉                 │"
c_green "└────────────────────────────────────────────┘"
echo ""
c_dim  "  داشبورد:        http://localhost:8080"
c_dim  "  پورتال موکلان:  http://localhost:8080/portal/"
c_dim  "  ویزارد راه‌اندازی: پس از نخستین ورود مالک، خودکار باز می‌شود"
echo ""
echo "  قدم‌های بعدی:"
echo "  1) داشبورد را باز کنید و با شمارهٔ موبایل مالک (OWNER_PHONE) وارد شوید."
echo "     تا وقتی پنل پیامک تنظیم نشده، کد ورود در لاگ API چاپ می‌شود:"
echo "     docker compose logs api | grep OTP"
echo "     سپس ویزارد شما را گام‌به‌گام راهنمایی می‌کند."
echo "  2) راهنمای کامل فارسی:  docs/RUNBOOK.md"
echo "  3) لاگ‌ها:              docker compose logs -f api"
echo "  4) بکاپ:                ./scripts/backup.sh"
echo "  5) توقف:                ./scripts/stop.sh"
echo ""
