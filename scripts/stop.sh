#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Stop Services
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"
docker compose down

echo "[OK] Services stopped successfully"
