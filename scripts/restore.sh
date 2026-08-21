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
MANIFEST_FILE=""
if [[ -f "$TEMP_DIR/manifest.json" ]]; then
    MANIFEST_FILE="$TEMP_DIR/manifest.json"
elif [[ -f "$TEMP_DIR/manifest-"*".json" ]]; then
    MANIFEST_FILE=$(ls "$TEMP_DIR"/manifest-*.json | head -1)
else
    log_error "Manifest file not found in backup archive"
    exit 1
fi

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

# Stop api and worker before restore
log_info "Stopping api and worker services..."
cd "$ROOT_DIR"
docker compose stop api worker || true

# Restore database
log_info "Restoring database..."
docker compose exec -T postgres pg_restore \
    -U postgres \
    -d legal_platform \
    --clean \
    --if-exists \
    < "$TEMP_DIR/db_dump.sql" || {
    log_error "Database restore failed"
    docker compose start api worker || true
    exit 1
}

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
