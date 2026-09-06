#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Restore Script
# Requires explicit --confirm flag and artifact path

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

log_info() { echo "[INFO] $*"; }
log_error() { echo "[ERROR] $*" >&2; }
log_success() { echo "[OK] $*"; }

usage() {
    echo "Usage: $0 --confirm <backup_file.tar.gz>"
    echo ""
    echo "Options:"
    echo "  --confirm    Required flag to confirm restore operation"
    echo "  <file>       Path to backup archive (backup-YYYYMMDD-HHMMSS.tar.gz)"
    echo ""
    echo "Example:"
    echo "  $0 --confirm ./backups/backup-20240101-120000.tar.gz"
    exit 1
}

CONFIRM=false
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --confirm)
            CONFIRM=true
            shift
            ;;
        *)
            if [[ -z "$BACKUP_FILE" ]]; then
                BACKUP_FILE="$1"
            else
                log_error "Unexpected argument: $1"
                usage
            fi
            shift
            ;;
    esac
done

if [[ "$CONFIRM" != "true" ]]; then
    log_error "Restore requires explicit confirmation. Use --confirm flag."
    log_error "Example: $0 --confirm ./backups/backup-20240101-120000.tar.gz"
    exit 1
fi

if [[ -z "$BACKUP_FILE" ]]; then
    log_error "Backup file path required"
    usage
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
fi

log_info "Starting restore process..."
log_info "Backup file: $BACKUP_FILE"

# Extract backup to temp directory
TEMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

log_info "Extracting backup archive..."
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Find manifest file
# NOTE (caught by the CI backup/restore drill): bash's [[ -f path* ]] does NOT
# glob-expand the asterisk inside [[ ]]—that branch always silently failed.
# Use a real glob loop outside the test instead.
MANIFEST_FILE=""
if [[ -f "$TEMP_DIR/manifest.json" ]]; then
    MANIFEST_FILE="$TEMP_DIR/manifest.json"
else
    shopt -s nullglob
    for f in "$TEMP_DIR"/manifest-*.json; do
        MANIFEST_FILE="$f"
        break
    done
    shopt -u nullglob
fi
if [[ -z "$MANIFEST_FILE" ]]; then
    log_error "Manifest file not found in backup archive"
    exit 1
fi
log_info "Found manifest: $MANIFEST_FILE"

log_info "Verifying checksums from manifest..."

# Extract expected checksums from manifest
DB_EXPECTED_SHA=$(grep -A2 '"db_dump"' "$MANIFEST_FILE" | grep sha256 | cut -d'"' -f4)
UPLOADS_EXPECTED_SHA=$(grep -A2 '"uploads"' "$MANIFEST_FILE" | grep sha256 | cut -d'"' -f4)

# Calculate actual checksums
DB_ACTUAL_SHA=$(sha256sum "$TEMP_DIR/db_dump.sql" | awk '{print $1}')
UPLOADS_ACTUAL_SHA=$(sha256sum "$TEMP_DIR/uploads.tar" | awk '{print $1}')

if [[ "$DB_EXPECTED_SHA" != "$DB_ACTUAL_SHA" ]]; then
    log_error "Database dump checksum mismatch!"
    log_error "Expected: $DB_EXPECTED_SHA"
    log_error "Actual:   $DB_ACTUAL_SHA"
    exit 1
fi

if [[ "$UPLOADS_EXPECTED_SHA" != "$UPLOADS_ACTUAL_SHA" ]]; then
    log_error "Uploads archive checksum mismatch!"
    log_error "Expected: $UPLOADS_EXPECTED_SHA"
    log_error "Actual:   $UPLOADS_ACTUAL_SHA"
    exit 1
fi

log_success "Checksum verification passed"

# Parse connection (URI or keyword form) so restore works in ANY deployment,
# not only ones where the OS user happens to be postgres.
if [[ -f "$ROOT_DIR/.env" ]]; then
    source "$ROOT_DIR/.env" 2>/dev/null || true
fi
DATABASE_URL="${DATABASE_URL:-postgresql://legal:postgres@localhost:5432/legal_platform}"
extract_uri_component() {
    echo "$1" | awk -v want="${2:-user}" '{
        if (match($0, /^[^:]+:\/\//)) {
            uri=$0
            sub(/^[^:]+:\/\//, "", uri)
            auth=uri; sub(/@.*/, "", auth)
            rest=uri; sub(/^[^@]*@/, "", rest)
            hostport=rest; sub(/\/.*$/, "", hostport); sub(/\?.*$/, "", hostport)
            name=rest; sub(/^[^/]*\//, "", name); sub(/\?.*$/, "", name)
            user=auth; sub(/:.*/, "", user)
            pass=auth; sub(/^[^:]+:/, "", pass)
            host=hostport; sub(/:.*/, "", host)
            port=hostport; sub(/^[^:]+:/, "", port)
            if (want=="user") print user
            else if (want=="pass") print pass
            else if (want=="host") print host
            else if (want=="port") print port
            else if (want=="name") print name
        }
    }'
}

url_decode() {
    # percent-decode for DSN credentials (pg itself decodes the URI; since we
    # split it manually for PGPASSWORD, we must mirror that)
    local s="${1//+/ }"
    printf '%b' "${s//%/\\x}"
}

if echo "$DATABASE_URL" | grep -qE '^[a-z]+://'; then
    DB_USER=$(extract_uri_component "$DATABASE_URL" user)
    DB_PASS=$(extract_uri_component "$DATABASE_URL" pass)
    DB_HOST=$(extract_uri_component "$DATABASE_URL" host); DB_HOST=${DB_HOST:-localhost}
    DB_PORT=$(extract_uri_component "$DATABASE_URL" port); DB_PORT=${DB_PORT:-5432}
    DB_NAME=$(extract_uri_component "$DATABASE_URL" name); DB_NAME=${DB_NAME:-legal_platform}
else
    DB_HOST=$(echo "$DATABASE_URL" | grep -oP 'host=\K[^ ]+' || echo "localhost")
    DB_PORT=$(echo "$DATABASE_URL" | grep -oP 'port=\K[^ ]+' || echo "5432")
    DB_NAME=$(echo "$DATABASE_URL" | grep -oP 'dbname=\K[^ ]+' || echo "legal_platform")
    DB_USER=$(echo "$DATABASE_URL" | grep -oP 'user=\K[^ ]+' || true)
    DB_PASS=$(echo "$DATABASE_URL" | grep -oP 'password=\K[^ ]+' || echo "")
fi
DB_PASS="${DB_PASS:-${POSTGRES_PASSWORD:-postgres}}"
DB_USER="${DB_USER:-${POSTGRES_USER:-postgres}}"
DB_PASS=$(url_decode "$DB_PASS")
DB_NAME="${DB_NAME:-${POSTGRES_DB:-legal_platform}}"

# Stop api and worker before restore
log_info "Stopping api and worker services..."
cd "$ROOT_DIR"
docker compose stop api worker || true

# Restore database — mirror backup.sh's two paths exactly:
# 1) direct pg_restore when the client binary is on PATH and DB is reachable
# 2) docker compose exec fallback for container-only deployments
log_info "Restoring database..."
if command -v pg_restore >/dev/null 2>&1 && [ -n "${DB_HOST:-}" ]; then
    log_info "Using direct pg_restore against $DB_HOST:$DB_PORT/$DB_NAME..."
    # --exit-on-error: pg_restore's DEFAULT exit semantics are broken for
    # scripting (exit 1 on harmless "errors ignored" warnings even when the
    # restore fully succeeded). With --exit-on-error, exit 1 means a REAL
    # error aborted the restore — a signal we can trust.
    PGPASSWORD="$DB_PASS" pg_restore \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --exit-on-error \
        --no-owner --no-privileges \
        --clean \
        --if-exists \
        < "$TEMP_DIR/db_dump.sql" || RESTORE_DIRECT_FAILED=1
fi

if [ "${RESTORE_DIRECT_FAILED:-}" = "1" ] || ! command -v pg_restore >/dev/null 2>&1; then
    log_info "Direct restore unavailable/failed, trying via docker compose..."
    docker compose exec -T postgres pg_restore \
        -U "${POSTGRES_USER:-legal}" \
        -d "${POSTGRES_DB:-legal_platform}" \
        --no-owner --no-privileges \
        --clean \
        --if-exists \
        < "$TEMP_DIR/db_dump.sql" || {
        log_error "Database restore failed"
        docker compose start api worker || true
        exit 1
    }
fi

# Restore uploads
log_info "Restoring uploads..."
if [[ -d "$ROOT_DIR/data/uploads" ]]; then
    tar -xf "$TEMP_DIR/uploads.tar" -C "$ROOT_DIR/data" || true
fi

# Restart services
log_info "Restarting services..."
docker compose start api worker

log_success "Restore completed successfully"
log_info "Please verify the restored data and run diagnostics if needed"
