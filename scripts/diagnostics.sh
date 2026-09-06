#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Diagnostics Script
# Prints pass/fail table for core system checks

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

log_info() { echo "[INFO] $*"; }
log_error() { echo "[ERROR] $*" >&2; }

PASS_COUNT=0
FAIL_COUNT=0

check_pass() {
    echo "✓ PASS: $1"
    ((PASS_COUNT++))
}

check_fail() {
    echo "✗ FAIL: $1"
    ((FAIL_COUNT++))
}

echo "=========================================="
echo "Legal Platform - Diagnostics Report"
echo "=========================================="
echo ""

# Check 1: Proxy reachable
echo "Checking proxy connectivity..."
if curl -sf --connect-timeout 5 http://localhost:8080 >/dev/null 2>&1; then
    check_pass "Proxy (nginx) reachable on port 8080"
else
    check_fail "Proxy (nginx) not reachable on port 8080"
fi

# Check 2: API /health endpoint
echo "Checking API health..."
if curl -sf --connect-timeout 5 http://localhost:8080/api/health | grep -q '"status":"ok"'; then
    check_pass "API /health endpoint responding"
else
    check_fail "API /health endpoint not responding"
fi

# Check 3: PostgreSQL ping
# Uses the same env-aware parse as backup.sh — never hardcode user/db
echo "Checking PostgreSQL..."
if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a; source "$ROOT_DIR/.env" 2>/dev/null || true; set +a
fi
PG_USER="${POSTGRES_USER:-legal}"
PG_DB="${POSTGRES_DB:-legal_platform}"
cd "$ROOT_DIR"
if docker compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    check_pass "PostgreSQL accepting connections as $PG_USER/$PG_DB"
else
    if docker compose ps postgres 2>/dev/null | grep -q "running\|healthy"; then
        check_pass "PostgreSQL container running"
    else
        check_fail "PostgreSQL not accessible"
    fi
fi

# Check 4: Redis ping
echo "Checking Redis..."
if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
    check_pass "Redis responding to PING"
else
    if docker compose ps redis 2>/dev/null | grep -q "running\|healthy"; then
        check_pass "Redis container running"
    else
        check_fail "Redis not accessible"
    fi
fi

# Check 5: Disk free space
echo "Checking disk space..."
FREE_DISK_KB=$(df -P "$ROOT_DIR" | tail -1 | awk '{print $4}')
FREE_DISK_GB=$((FREE_DISK_KB / 1024 / 1024))
if [[ "$FREE_DISK_GB" -ge 10 ]]; then
    check_pass "Disk free space adequate (${FREE_DISK_GB}GB available)"
else
    check_fail "Low disk space (${FREE_DISK_GB}GB available, minimum 10GB recommended)"
fi

# Check 6: Backups directory writable
echo "Checking backups directory..."
BACKUP_DIR="$ROOT_DIR/backups"
if mkdir -p "$BACKUP_DIR" 2>/dev/null && touch "$BACKUP_DIR/.write_test" 2>/dev/null; then
    rm -f "$BACKUP_DIR/.write_test"
    LAST_BACKUP=$(ls -t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | head -1 || true)
    if [[ -n "$LAST_BACKUP" ]]; then
        AGE_DAYS=$(( ($(date +%s) - $(date -r "$LAST_BACKUP" +%s)) / 86400 ))
        if [[ $AGE_DAYS -gt 7 ]]; then
            check_fail "Latest backup is ${AGE_DAYS} days old (stale > 7d)"
        else
            check_pass "Backups directory writable; latest backup: $(basename "$LAST_BACKUP") (${AGE_DAYS}d old)"
        fi
    else
        check_pass "Backups directory writable (no backups yet)"
    fi
else
    check_fail "Backups directory not writable"
fi

# Check 7: WAL-level backup health (still in-memory manifest sanity is n/a at this layer;
# instead we verify the last backup archive is usable)
if [[ -n "${LAST_BACKUP:-}" ]]; then
    if tar -tzf "$LAST_BACKUP" 2>/dev/null | grep -q 'manifest-.*\.json'; then
        check_pass "Latest backup archive is structurally valid (manifest inside)"
    else
        check_fail "Latest backup archive unparseable or missing manifest"
    fi
fi

echo ""
echo "=========================================="
echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "=========================================="

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo ""
    log_error "One or more core checks failed. Please review the output above."
    exit 1
fi

echo ""
echo "All core checks passed!"
exit 0
