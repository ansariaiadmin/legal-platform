#!/usr/bin/env bash
set -euo pipefail

# Legal Platform - Managed One-Command Installer
# Linux-only, idempotent installer for Ubuntu 22.04+

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

log_info() { echo "[INFO] $*"; }
log_error() { echo "[ERROR] $*" >&2; }
log_success() { echo "[OK] $*"; }

# Validate OS
validate_os() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "Cannot detect OS. This script requires Linux."
        exit 1
    fi
    
    source /etc/os-release
    
    if [[ "$ID" != "ubuntu" ]]; then
        log_error "This installer only supports Ubuntu. Detected: $ID"
        exit 1
    fi
    
    # Parse version number
    VERSION_ID_NUM=$(echo "$VERSION_ID" | cut -d'.' -f1)
    if [[ "$VERSION_ID_NUM" -lt 22 ]]; then
        log_error "Ubuntu 22.04 or higher required. Detected: $VERSION"
        exit 1
    fi
    
    log_success "OS validation passed: $PRETTY_NAME"
}

# Validate RAM >= 4GB
validate_ram() {
    TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))
    
    if [[ "$TOTAL_RAM_GB" -lt 4 ]]; then
        log_error "Minimum 4GB RAM required. Detected: ${TOTAL_RAM_GB}GB"
        exit 1
    fi
    
    log_success "RAM validation passed: ${TOTAL_RAM_GB}GB"
}

# Validate free disk >= 40GB
validate_disk() {
    FREE_DISK_KB=$(df -P "$ROOT_DIR" | tail -1 | awk '{print $4}')
    FREE_DISK_GB=$((FREE_DISK_KB / 1024 / 1024))
    
    if [[ "$FREE_DISK_GB" -lt 40 ]]; then
        log_error "Minimum 40GB free disk space required. Detected: ${FREE_DISK_GB}GB"
        exit 1
    fi
    
    log_success "Disk validation passed: ${FREE_DISK_GB}GB free"
}

# Install Docker + compose plugin if missing
install_docker() {
    if command -v docker &>/dev/null && docker --version &>/dev/null; then
        log_info "Docker already installed: $(docker --version)"
    else
        log_info "Installing Docker..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq ca-certificates curl gnupg
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list

        apt-get update -qq
        apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        log_success "Docker installed"
    fi

    # Ubuntu 24.04 (noble): docker.service may be installed-but-stopped, and
    # containerd's socket activation needs an explicit nudge on some images.
    systemctl enable --now docker >/dev/null 2>&1 || true
    systemctl enable --now containerd >/dev/null 2>&1 || true

    # Add the invoking user to the docker group so post-install ops
    # (diagnostics/backup) don't need sudo.
    if [[ -n "${SUDO_USER:-}" ]] && ! id -nG "$SUDO_USER" | grep -qw docker; then
        usermod -aG docker "$SUDO_USER" || true
        log_info "User '$SUDO_USER' added to docker group (log out/in to take effect)"
    fi

    # Wait for the daemon to be truly ready (socket up, version answered)
    log_info "Waiting for docker daemon..."
    local attempts=0
    until docker info >/dev/null 2>&1; do
        attempts=$((attempts + 1))
        if [[ $attempts -ge 30 ]]; then
            log_error "Docker daemon did not become ready in 30s"
            exit 1
        fi
        sleep 1
    done
    log_success "Docker daemon ready"

    if ! docker compose version &>/dev/null; then
        log_error "Docker compose plugin not found after installation"
        exit 1
    fi

    log_success "Docker compose plugin available: $(docker compose version)"
}

# Generate a random secret (64 hex characters == 32 bytes)
generate_secret() {
    openssl rand -hex 32
}

# The encryption key must decode to exactly 32 bytes. `openssl rand -hex 32`
# produces 64 hex characters, which is accepted, but base64 is the canonical
# form the API documents, so emit that instead.
generate_encryption_key() {
    openssl rand -base64 32
}

# Setup .env file
setup_env() {
    if [[ -f "$ENV_FILE" ]]; then
        log_info ".env file already exists, skipping creation"
        return 0
    fi
    
    if [[ ! -f "$ENV_EXAMPLE" ]]; then
        log_error ".env.example not found at $ENV_EXAMPLE"
        exit 1
    fi
    
    log_info "Creating .env from .env.example with generated secrets..."
    
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    
    # Replace secrets with real random values
    JWT_ACCESS=$(generate_secret)
    JWT_REFRESH=$(generate_secret)
    ENCRYPTION_KEY=$(generate_encryption_key)
    PG_PASS=$(generate_secret)          # hex — safe to embed in DSN without %-escaping
    OTP_PEPPER=$(generate_secret)       # per-install HMAC pepper for OTP hashes

    sed -i "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$JWT_ACCESS/" "$ENV_FILE"
    sed -i "s/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH/" "$ENV_FILE"
    sed -i "s|^ENCRYPTION_MASTER_KEY=.*|ENCRYPTION_MASTER_KEY=$ENCRYPTION_KEY|" "$ENV_FILE"
    # Keep POSTGRES_PASSWORD and the password inside DATABASE_URL IN SYNC;
    # the API talks to the postgres container through the DSN line.
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PG_PASS/" "$ENV_FILE"
    sed -i "s|^DATABASE_URL=postgresql://legal:[^@]*@|DATABASE_URL=postgresql://legal:$PG_PASS@|" "$ENV_FILE"
    # OTP pepper: fill only if empty (never overwrite an existing one — that
    # would brick every issued OTP)
    if grep -qE '^OTP_HASH_PEPPER=$' "$ENV_FILE"; then
        sed -i "s/^OTP_HASH_PEPPER=$/OTP_HASH_PEPPER=$OTP_PEPPER/" "$ENV_FILE"
    fi
    
    log_success ".env file created with secure secrets"
}

# Wait for health endpoint
wait_for_health() {
    local timeout=${1:-120}
    local elapsed=0
    local interval=5
    
    log_info "Waiting for service to become healthy (timeout: ${timeout}s)..."
    
    while [[ $elapsed -lt $timeout ]]; do
        if curl -sf http://localhost:8080/api/health | grep -q '"status":"ok"'; then
            log_success "Service is healthy"
            return 0
        fi
        sleep $interval
        elapsed=$((elapsed + interval))
        log_info "Still waiting... (${elapsed}s/${timeout}s)"
    done
    
    log_error "Health check timed out after ${timeout}s"
    exit 1
}

# Main execution
main() {
    log_info "Starting Legal Platform installer..."
    
    validate_os
    validate_ram
    validate_disk
    install_docker
    setup_env
    
    log_info "Building and starting services..."
    cd "$ROOT_DIR"
    docker compose up -d --build
    # Run database migrations before health check
    log_info "Running database migrations..."
    docker compose run --rm api npm run migrate:up || {
        log_error "Database migration failed"
        exit 1
    }
    log_success "Database migrations completed"
    
    wait_for_health 120
    
    log_success "Installation complete!"
    echo ""
    echo "Dashboard URL: http://localhost:8080"
    echo ""
    echo "Next steps:"
    echo "  1. Visit http://localhost:8080 to access the platform"
    echo "  2. Run ./scripts/diagnostics.sh to verify all services"
    echo "  3. Configure providers via the dashboard settings"
    echo ""
}

main "$@"
