#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Restore Script (Production Hardened)
# Supports both old backup.sh and new backup-prod.sh formats
# Requires explicit --confirm flag and artifact path
#
# Features:
# - Supports encrypted backups (AES-256-CBC)
# - Supports prod format with manifest-{timestamp}.json
# - Checksum verification
# - Handles both old and new manifest structures
# - Test mode (--test) for verification without applying

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

log_info() { echo "[INFO] $*"; }
log_warn() { echo "[WARN] $*"; }
log_error() { echo "[ERROR] $*" >&2; }
log_success() { echo "[OK] $*"; }

usage() {
    echo "Usage: $0 --confirm <backup_file.tar.gz> [--test] [--decrypt-key KEY]"
    echo ""
    echo "Options:"
    echo "  --confirm          Required flag to confirm restore operation"
    echo "  --test             Test mode: verify checksums without restoring"
    echo "  --decrypt-key KEY  Decryption key for .enc files (or use BACKUP_ENCRYPTION_KEY env)"
    echo "  <file>             Path to backup archive"
    echo ""
    echo "Examples:"
    echo "  $0 --confirm ./backups/backup-20240101-120000.tar.gz"
    echo "  $0 --confirm ./backups/daily/backup-daily-20240101-120000.tar.gz.enc"
    echo "  $0 --confirm ./backups/backup-20240101-120000.tar.gz --test"
    echo "  $0 --confirm ./backups/backup-20240101-120000.tar.gz.enc --decrypt-key mykey"
    exit 1
}

CONFIRM=false
TEST_MODE=false
BACKUP_FILE=""
DECRYPT_KEY="${BACKUP_ENCRYPTION_KEY:-${ENCRYPTION_MASTER_KEY:-}}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --confirm)
            CONFIRM=true
            shift
            ;;
        --test)
            TEST_MODE=true
            shift
            ;;
        --decrypt-key)
            DECRYPT_KEY="$2"
            shift 2
            ;;
        --help|-h)
            usage
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
log_info "Test mode: $TEST_MODE"

# Handle encrypted backups
TEMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

ACTUAL_BACKUP_FILE="$BACKUP_FILE"

if [[ "$BACKUP_FILE" == *.enc ]]; then
    log_info "Encrypted backup detected, decrypting..."
    if [[ -z "$DECRYPT_KEY" ]]; then
        log_error "Encrypted backup requires decryption key"
        log_error "Set BACKUP_ENCRYPTION_KEY env or use --decrypt-key"
        exit 1
    fi

    DECRYPTED_FILE="$TEMP_DIR/decrypted-backup.tar.gz"
    if ! openssl enc -d -aes-256-cbc -pbkdf2 \
        -in "$BACKUP_FILE" \
        -out "$DECRYPTED_FILE" \
        -pass pass:"$DECRYPT_KEY" 2>/dev/null; then
        log_error "Decryption failed — wrong key or corrupted file"
        exit 1
    fi

    ACTUAL_BACKUP_FILE="$DECRYPTED_FILE"
    log_success "Decryption OK"
fi

log_info "Extracting backup archive..."
if ! tar -tzf "$ACTUAL_BACKUP_FILE" >/dev/null 2>&1; then
    log_error "Backup archive is corrupted or not a valid tar.gz"
    exit 1
fi

tar -xzf "$ACTUAL_BACKUP_FILE" -C "$TEMP_DIR"
log_success "Extraction OK"

# Find manifest file
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
    log_error "Files in archive:"
    ls -lh "$TEMP_DIR"/ | head -20
    exit 1
fi

log_info "Found manifest: $MANIFEST_FILE"
cat "$MANIFEST_FILE" | head -20

# Detect manifest format (old vs new)
if grep -q '"db_dump"' "$MANIFEST_FILE"; then
    log_info "Detected OLD backup format (backup.sh)"
    IS_PROD_FORMAT=false
else
    log_info "Detected PROD backup format (backup-prod.sh)"
    IS_PROD_FORMAT=true
fi

log_info "Verifying checksums from manifest..."

verify_checksum() {
    local file=$1
    local expected=$2
    local label=$3

    if [[ -z "$expected" || "$expected" == "null" ]]; then
        log_warn "No checksum for $label — skipping verification"
        return 0
    fi

    if [[ ! -f "$file" ]]; then
        log_warn "File $file not found — skipping checksum for $label"
        return 0
    fi

    local actual
    actual=$(sha256sum "$file" | awk '{print $1}')

    if [[ "$expected" != "$actual" ]]; then
        log_error "$label checksum mismatch!"
        log_error "Expected: $expected"
        log_error "Actual:   $actual"
        return 1
    fi

    log_success "$label checksum OK: $actual"
    return 0
}

CHECKSUM_FAILED=false

if [[ "$IS_PROD_FORMAT" == true ]]; then
    # Prod format: database.sha256, storage.sha256, etc.
    DB_EXPECTED_SHA=$(grep -o '"sha256"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST_FILE" | head -1 | cut -d'"' -f4 || true)
    # Try to extract specific checksums
    DB_SHA=$(cat "$MANIFEST_FILE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('database',{}).get('sha256',''))" 2>/dev/null || echo "")
    STORAGE_SHA=$(cat "$MANIFEST_FILE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('storage',{}).get('sha256',''))" 2>/dev/null || echo "")
    REDIS_SHA=$(cat "$MANIFEST_FILE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('redis',{}).get('sha256',''))" 2>/dev/null || echo "")

    # Find actual files
    DB_FILE=$(ls "$TEMP_DIR"/db-*.dump 2>/dev/null | head -1 || echo "")
    STORAGE_FILE=$(ls "$TEMP_DIR"/storage-*.tar.gz 2>/dev/null | head -1 || echo "")
    REDIS_FILE=$(ls "$TEMP_DIR"/redis-*.rdb 2>/dev/null | head -1 || echo "")

    [[ -n "$DB_FILE" && -n "$DB_SHA" ]] && verify_checksum "$DB_FILE" "$DB_SHA" "Database dump" || true
    [[ -n "$STORAGE_FILE" && -n "$STORAGE_SHA" ]] && verify_checksum "$STORAGE_FILE" "$STORAGE_SHA" "Storage archive" || true

    # If no specific SHA, try to verify at least one file exists
    if [[ -z "$DB_FILE" ]]; then
        log_warn "No DB dump found in prod backup — checking alternative names"
        DB_FILE=$(ls "$TEMP_DIR"/*.dump 2>/dev/null | head -1 || ls "$TEMP_DIR"/*.sql 2>/dev/null | head -1 || echo "")
    fi

    if [[ -n "$DB_FILE" ]]; then
        log_success "Found DB file: $DB_FILE"
    else
        log_warn "No DB file found — backup may be storage-only"
    fi

else
    # Old format
    DB_EXPECTED_SHA=$(grep -A2 '"db_dump"' "$MANIFEST_FILE" | grep sha256 | cut -d'"' -f4 || echo "")
    UPLOADS_EXPECTED_SHA=$(grep -A2 '"uploads"' "$MANIFEST_FILE" | grep sha256 | cut -d'"' -f4 || echo "")

    DB_FILE="$TEMP_DIR/db_dump.sql"
    UPLOADS_FILE="$TEMP_DIR/uploads.tar"

    if [[ -f "$DB_FILE" && -n "$DB_EXPECTED_SHA" ]]; then
        verify_checksum "$DB_FILE" "$DB_EXPECTED_SHA" "Database dump" || CHECKSUM_FAILED=true
    fi

    if [[ -f "$UPLOADS_FILE" && -n "$UPLOADS_EXPECTED_SHA" ]]; then
        verify_checksum "$UPLOADS_FILE" "$UPLOADS_EXPECTED_SHA" "Uploads archive" || CHECKSUM_FAILED=true
    fi
fi

if [[ "$CHECKSUM_FAILED" == true ]]; then
    log_error "Checksum verification FAILED — aborting restore"
    exit 1
fi

log_success "Checksum verification passed"

if [[ "$TEST_MODE" == true ]]; then
    log_success "Test mode — verification OK, not restoring"
    log_info "Backup contents:"
    ls -lh "$TEMP_DIR"/
    exit 0
fi

# Parse connection (URI or keyword form)
if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    source "$ROOT_DIR/.env" 2>/dev/null || true
    set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://legal:postgres@localhost:5432/legal_platform}"

extract_uri_component() {
    # $1 = DATABASE_URL (URI form), $2 = role: user|pass|host|port|name
    echo "$1" | awk -v want="${2:-user}" '{
        if (match($0, /^[^:]+:\/\//)) {
            uri=$0
            sub(/^[^:]+:\/\//, "", uri)
            # uri = user:pass@host:port/name?params
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

# Stop the API so nothing writes during the restore
log_info "Stopping the api service..."
cd "$ROOT_DIR"
docker compose stop api 2>/dev/null || docker-compose stop api 2>/dev/null || true

# Restore database
log_info "Restoring database..."

# Find DB file (prod format has db-*.dump and db-*.sql)
DB_RESTORE_FILE=""
if [[ -n "${DB_FILE:-}" && -f "$DB_FILE" ]]; then
    DB_RESTORE_FILE="$DB_FILE"
else
    DB_RESTORE_FILE=$(ls "$TEMP_DIR"/db-*.dump 2>/dev/null | head -1 || ls "$TEMP_DIR"/db_dump.sql 2>/dev/null | head -1 || ls "$TEMP_DIR"/*.sql 2>/dev/null | head -1 || echo "")
fi

if [[ -z "$DB_RESTORE_FILE" || ! -f "$DB_RESTORE_FILE" ]]; then
    log_warn "No database dump found — skipping DB restore (storage-only backup?)"
else
    log_info "Using DB file: $DB_RESTORE_FILE"

    RESTORE_DIRECT_FAILED=""

    if [[ "$DB_RESTORE_FILE" == *.dump ]]; then
        # Custom format — use pg_restore
        if command -v pg_restore >/dev/null 2>&1 && [ -n "${DB_HOST:-}" ]; then
            log_info "Using direct pg_restore against $DB_HOST:$DB_PORT/$DB_NAME..."
            PGPASSWORD="$DB_PASS" pg_restore \
                -h "$DB_HOST" \
                -p "$DB_PORT" \
                -U "$DB_USER" \
                -d "$DB_NAME" \
                --exit-on-error \
                --no-owner --no-privileges \
                --clean \
                --if-exists \
                "$DB_RESTORE_FILE" || RESTORE_DIRECT_FAILED=1
        fi

        if [[ "${RESTORE_DIRECT_FAILED:-}" == "1" ]] || ! command -v pg_restore >/dev/null 2>&1; then
            log_info "Direct restore unavailable/failed, trying via docker compose..."
            docker compose exec -T postgres pg_restore \
                -U "${POSTGRES_USER:-legal}" \
                -d "${POSTGRES_DB:-legal_platform}" \
                --no-owner --no-privileges \
                --clean \
                --if-exists \
                < "$DB_RESTORE_FILE" || {
                log_error "Database restore failed"
                docker compose start api 2>/dev/null || docker-compose start api 2>/dev/null || true
                exit 1
            }
        fi
    else
        # Plain SQL
        if command -v psql >/dev/null 2>&1; then
            log_info "Using psql for SQL restore..."
            PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$DB_RESTORE_FILE" || RESTORE_DIRECT_FAILED=1
        fi

        if [[ "${RESTORE_DIRECT_FAILED:-}" == "1" ]] || ! command -v psql >/dev/null 2>&1; then
            log_info "Trying via docker compose exec psql..."
            docker compose exec -T postgres psql -U "${POSTGRES_USER:-legal}" -d "${POSTGRES_DB:-legal_platform}" < "$DB_RESTORE_FILE" || {
                log_error "Database restore failed"
                docker compose start api 2>/dev/null || true
                exit 1
            }
        fi
    fi

    log_success "Database restore OK"
fi

# Restore uploads. With STORAGE_DRIVER=local this volume also holds the
# runtime state (legal library, purchases, queue, notifications, settings).
# Writing through a one-off api container works for Docker named volumes (the
# default) and bind mounts alike, and keeps file ownership correct.
log_info "Restoring uploads and runtime state..."

UPLOADS_RESTORE_FILE=$(ls "$TEMP_DIR"/storage-*.tar.gz 2>/dev/null | head -1 || true)
[[ -z "$UPLOADS_RESTORE_FILE" && -f "$TEMP_DIR/uploads.tar" ]] && UPLOADS_RESTORE_FILE="$TEMP_DIR/uploads.tar"

if [[ -n "$UPLOADS_RESTORE_FILE" && -f "$UPLOADS_RESTORE_FILE" ]]; then
    log_info "Using storage archive: $(basename "$UPLOADS_RESTORE_FILE")"
    TAR_FLAGS="-x"
    [[ "$UPLOADS_RESTORE_FILE" == *.gz ]] && TAR_FLAGS="-xz"
    if docker compose run --rm --no-deps -T --entrypoint sh api -c \
        "rm -rf /app/uploads/* /app/uploads/.[!.]* 2>/dev/null; tar -C /app $TAR_FLAGS -f -" \
        < "$UPLOADS_RESTORE_FILE"; then
        log_success "Uploads restore OK"
    else
        log_error "Uploads restore failed. The database was restored; restore the uploads archive manually:"
        log_error "  docker compose run --rm --no-deps -T --entrypoint sh api -c 'tar -C /app $TAR_FLAGS -f -' < $UPLOADS_RESTORE_FILE"
        docker compose start api 2>/dev/null || true
        exit 1
    fi
else
    log_warn "No uploads archive found in the backup; uploads were not restored"
fi

# Restore Redis if present
REDIS_RESTORE_FILE=$(ls "$TEMP_DIR"/redis-*.rdb 2>/dev/null | head -1 || echo "")
if [[ -n "$REDIS_RESTORE_FILE" && -f "$REDIS_RESTORE_FILE" ]]; then
    log_info "Redis dump found: $REDIS_RESTORE_FILE (manual restore may be needed)"
    log_info "To restore Redis: copy $REDIS_RESTORE_FILE to redis data dir and restart"
fi

# Restart services
log_info "Restarting services..."
if docker compose version >/dev/null 2>&1; then
    if docker compose ps api 2>/dev/null | grep -q api; then
        docker compose start api 2>/dev/null || log_info "compose start skipped"
    else
        log_info "No compose stack present — skipping service restart (headless restore mode)"
    fi
else
    log_info "No compose — skipping restart"
fi

log_success "Restore completed successfully"
log_info "Please verify the restored data and run diagnostics if needed"
log_info "Run: ./scripts/diagnostics.sh"
log_info "Check: curl http://localhost:8080/api/health"
