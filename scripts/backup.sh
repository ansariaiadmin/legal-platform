#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Backup Script
# Creates backup of database (excluding provider_configs) and uploads volume

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
BACKUP_DIR="$ROOT_DIR/backups"
BACKUP_NAME="backup-${TIMESTAMP}.tar.gz"
MANIFEST_FILE="$ROOT_DIR/backups/manifest-${TIMESTAMP}.json"
TEMP_DIR=$(mktemp -d)

log_info() { echo "[INFO] $*"; }
log_error() { echo "[ERROR] $*" >&2; }
log_success() { echo "[OK] $*"; }

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"

log_info "Starting backup process..."

# Get database connection from .env or use default
if [[ -f "$ROOT_DIR/.env" ]]; then
    source "$ROOT_DIR/.env"
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/legal_platform}"

# Extract database connection details
DB_HOST=$(echo "$DATABASE_URL" | grep -oP 'host=\K[^ ]+' || echo "localhost")
DB_PORT=$(echo "$DATABASE_URL" | grep -oP 'port=\K[^ ]+' || echo "5432")
DB_NAME=$(echo "$DATABASE_URL" | grep -oP 'dbname=\K[^ ]+' || echo "legal_platform")
DB_USER=$(echo "$DATABASE_URL" | grep -oP 'user=\K[^ ]+' || echo "postgres")

# Dump database excluding provider_configs table
log_info "Dumping database (excluding provider_configs)..."
DB_DUMP_FILE="$TEMP_DIR/db_dump.sql"

PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --exclude-table-data=provider_configs \
    -F c \
    -f "$DB_DUMP_FILE" 2>/dev/null || {
    # Fallback: try with docker compose
    log_info "Direct pg_dump failed, trying via docker compose..."
    docker compose exec -T postgres pg_dump \
        -U postgres \
        -d legal_platform \
        --exclude-table-data=provider_configs \
        -F c > "$DB_DUMP_FILE"
}

# Tar uploads volume data
UPLOADS_DUMP="$TEMP_DIR/uploads.tar"
log_info "Archiving uploads..."
if [[ -d "$ROOT_DIR/data/uploads" ]]; then
    tar -cf "$UPLOADS_DUMP" -C "$ROOT_DIR/data" uploads 2>/dev/null || true
else
    # Create empty archive if no uploads exist
    mkdir -p "$TEMP_DIR/empty_uploads"
    tar -cf "$UPLOADS_DUMP" -C "$TEMP_DIR" empty_uploads
fi

# Create manifest with metadata
log_info "Creating manifest..."
DB_CHECKSUM=$(sha256sum "$DB_DUMP_FILE" | awk '{print $1}')
UPLOADS_CHECKSUM=$(sha256sum "$UPLOADS_DUMP" | awk '{print $1}')

cat > "$MANIFEST_FILE" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "backup_name": "$BACKUP_NAME",
  "services": {
    "postgres": "$(docker compose ps -q postgres 2>/dev/null | head -1 || echo 'unknown')",
    "api": "$(docker compose ps -q api 2>/dev/null | head -1 || echo 'unknown')",
    "web": "$(docker compose ps -q web 2>/dev/null | head -1 || echo 'unknown')"
  },
  "files": {
    "db_dump": {
      "filename": "db_dump.sql",
      "sha256": "$DB_CHECKSUM"
    },
    "uploads": {
      "filename": "uploads.tar",
      "sha256": "$UPLOADS_CHECKSUM"
    }
  },
  "version": "1.0.0"
}
EOF

# Create final backup archive
log_info "Creating backup archive: $BACKUP_DIR/$BACKUP_NAME"
tar -czf "$BACKUP_DIR/$BACKUP_NAME" \
    -C "$TEMP_DIR" \
    db_dump.sql \
    uploads.tar \
    manifest-${TIMESTAMP}.json

# Copy manifest into the backup archive too
cp "$MANIFEST_FILE" "$TEMP_DIR/manifest.json"

log_success "Backup completed successfully"
log_info "Backup file: $BACKUP_DIR/$BACKUP_NAME"
log_info "Manifest file: $MANIFEST_FILE"

# List backup info
ls -lh "$BACKUP_DIR/$BACKUP_NAME"
