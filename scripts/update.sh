#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Update Script
# Runs backup first, then rebuilds and updates services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

log_info() { echo "[INFO] $*"; }
log_error() { echo "[ERROR] $*" >&2; }
log_success() { echo "[OK] $*"; }

BACKUP_FILE=""

# Run backup first
log_info "Running pre-update backup..."
if "$SCRIPT_DIR/backup.sh"; then
    log_success "Backup completed"
    # Extract the backup file path from the last line of output
    BACKUP_FILE=$(ls -t "$ROOT_DIR/backups"/backup-*.tar.gz 2>/dev/null | head -1)
else
    log_error "Backup failed, aborting update"
    exit 1
fi

log_info "Starting update process..."
log_info "Backup created at: $BACKUP_FILE"

cd "$ROOT_DIR"

# Run database migrations before rebuilding
log_info "Running database migrations..."
if ! docker compose run --rm api npm run migrate:up; then
    log_error "Database migration failed, aborting update"
    exit 1
fi
log_success "Database migrations completed"

# Pull latest images and rebuild
log_info "Rebuilding services..."
if ! docker compose up -d --build; then
    log_error "Build failed, initiating rollback..."
    
    # Rollback: stop new containers, restore from backup
    docker compose down || true
    
    if [[ -n "$BACKUP_FILE" ]] && [[ -f "$BACKUP_FILE" ]]; then
        log_info "Restoring from backup: $BACKUP_FILE"
        "$SCRIPT_DIR/restore.sh" --confirm "$BACKUP_FILE" || {
            log_error "Rollback failed! Manual intervention required."
            exit 1
        }
    else
        log_error "No backup found for rollback. Manual intervention required."
        exit 1
    fi
    
    log_error "Update rolled back due to build failure"
    exit 1
fi

# Verify health
log_info "Verifying service health..."
sleep 10  # Give services time to start

HEALTH_OK=false
for i in {1..24}; do
    if curl -sf http://localhost:8080/api/health | grep -q '"status":"ok"'; then
        HEALTH_OK=true
        break
    fi
    log_info "Waiting for healthy response... (attempt $i/24)"
    sleep 5
done

if [[ "$HEALTH_OK" != "true" ]]; then
    log_error "Health check failed after update, initiating rollback..."
    
    docker compose down || true
    
    if [[ -n "$BACKUP_FILE" ]] && [[ -f "$BACKUP_FILE" ]]; then
        log_info "Restoring from backup: $BACKUP_FILE"
        "$SCRIPT_DIR/restore.sh" --confirm "$BACKUP_FILE" || {
            log_error "Rollback failed! Manual intervention required."
            exit 1
        }
    else
        log_error "No backup found for rollback. Manual intervention required."
        exit 1
    fi
    
    log_error "Update rolled back due to health check failure"
    exit 1
fi

log_success "Update completed successfully"
log_info "Services are running and healthy"
log_info "Backup retained at: $BACKUP_FILE"
