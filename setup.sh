#!/usr/bin/env bash
#
# ╔══════════════════════════════════════════════════════════════════╗
# ║     Legal Platform — نصب کامل با یک دستور (Ubuntu 22.04+)        ║
# ╚══════════════════════════════════════════════════════════════════╝
#
#   اجرا:        sudo ./setup.sh
#   فقط-چک:     sudo ./setup.sh --check
#
# It validates the host, installs Docker if missing, generates all secrets,
# builds & starts the stack, runs migrations, and waits until healthy.
# On success it prints the dashboard URL and the exact credentials file.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
c_red()   { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
c_dim()   { printf '\033[0;36m%s\033[0m\n' "$*"; }

banner() {
  echo ""
  c_green "┌────────────────────────────────────────────┐"
  c_green "│   پلتفرم حقوقی — نصب خودکار (Legal SaaS)   │"
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
c_dim  "  ستاپ‌ویزارد:   همان صفحهٔ اول — اگر نصب تازه باشد ویزارد خودش بالا می‌آید"
echo ""
echo "  قدم‌های بعدی:"
echo "  1) مرورگر را باز کنید و به آدرس بالا بروید — ویزارد شما را قدم‌به‌قدم"
echo "     راهنمایی می‌کند (مالک، رمز عبور، اتصال پیامک/درگاه)."
echo "  2) راهنمای کامل فارسی:  docs/RUNBOOK.md"
echo "  3) لاگ‌ها:              docker compose logs -f api"
echo "  4) بکاپ:                ./scripts/backup.sh"
echo "  5) توقف:                ./scripts/stop.sh"
echo ""
