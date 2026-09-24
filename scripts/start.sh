#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Start Services
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"
docker compose up -d

echo "[OK] Services started successfully"
