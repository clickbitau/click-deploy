#!/bin/bash
# ============================================================
# Click-Deploy — One-Line Installer
# ============================================================
# Usage: curl -fsSL https://raw.githubusercontent.com/clickbitau/click-deploy/main/install.sh | bash
#
# What it does:
#   1. Checks for Docker & Docker Compose (installs if missing)
#   2. Creates /opt/click-deploy directory
#   3. Downloads docker-compose.yml and .env.example
#   4. Generates secure secrets
#   5. Runs docker compose up -d
#   6. Prints access URL
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

INSTALL_DIR="/opt/click-deploy"
REPO_RAW="https://raw.githubusercontent.com/clickbitau/click-deploy/main"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       ⚡ Click-Deploy Installer ⚡       ║${NC}"
echo -e "${CYAN}║      Self-Hosted PaaS Platform           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Check root ───────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}✗ Please run as root (sudo)${NC}"
  exit 1
fi

# ── Detect OS ────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
  elif command -v uname &> /dev/null; then
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  else
    OS="unknown"
  fi
  echo -e "${BLUE}→ Detected OS: ${OS} ${OS_VERSION:-}${NC}"
}

# ── Install Docker ───────────────────────────────────────────
install_docker() {
  if command -v docker &> /dev/null; then
    DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")
    echo -e "${GREEN}✓ Docker already installed (v${DOCKER_VER})${NC}"
    return
  fi

  echo -e "${YELLOW}→ Installing Docker...${NC}"

  case "$OS" in
    ubuntu|debian|pop|linuxmint|elementary)
      apt-get update -qq
      apt-get install -y -qq ca-certificates curl gnupg lsb-release
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
      apt-get update -qq
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    centos|rhel|rocky|almalinux|fedora)
      if command -v dnf &> /dev/null; then
        dnf install -y -q dnf-plugins-core
        dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
      else
        yum install -y -q yum-utils
        yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        yum install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
      fi
      ;;
    alpine)
      apk add --no-cache docker docker-compose
      rc-update add docker boot 2>/dev/null || true
      ;;
    arch|manjaro)
      pacman -Sy --noconfirm docker docker-compose
      ;;
    *)
      echo -e "${YELLOW}→ Unknown OS, trying get.docker.com script...${NC}"
      curl -fsSL https://get.docker.com | sh
      ;;
  esac

  # Start and enable Docker
  systemctl start docker 2>/dev/null || service docker start 2>/dev/null || dockerd &
  systemctl enable docker 2>/dev/null || true

  echo -e "${GREEN}✓ Docker installed${NC}"
}

# ── Configure Docker Daemon (insecure registry for Swarm) ────
configure_docker_daemon() {
  DAEMON_JSON="/etc/docker/daemon.json"
  # Detect this node's primary IP for the registry reference
  NODE_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

  # If a manager IP was passed via MANAGER_IP env var, use that for registry;
  # otherwise default to localhost (standalone single-node installs).
  REGISTRY_IP="${MANAGER_IP:-$NODE_IP}"

  echo -e "${BLUE}→ Configuring Docker daemon for private registry...${NC}"

  # Build insecure-registries list — include all common access patterns
  if [ -f "$DAEMON_JSON" ]; then
    # Merge with existing config if present (preserve user settings)
    if grep -q "insecure-registries" "$DAEMON_JSON" 2>/dev/null; then
      echo -e "${GREEN}✓ Docker daemon.json already has insecure-registries configured${NC}"
      return
    fi
    # File exists but no insecure-registries — add it via temp merge
    echo -e "${YELLOW}→ Adding insecure-registries to existing daemon.json...${NC}"
    python3 -c "
import json, sys
with open('$DAEMON_JSON') as f:
    cfg = json.load(f)
cfg.setdefault('insecure-registries', [])
for reg in ['localhost:5000', '${REGISTRY_IP}:5000']:
    if reg not in cfg['insecure-registries']:
        cfg['insecure-registries'].append(reg)
with open('$DAEMON_JSON', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || {
      # Fallback if python3 not available — write fresh config
      cat > "$DAEMON_JSON" <<DAEMONJSON
{
  "insecure-registries": ["localhost:5000", "${REGISTRY_IP}:5000"]
}
DAEMONJSON
    }
  else
    # No daemon.json exists — create it
    cat > "$DAEMON_JSON" <<DAEMONJSON
{
  "insecure-registries": ["localhost:5000", "${REGISTRY_IP}:5000"]
}
DAEMONJSON
  fi

  # Restart Docker to pick up the new config
  systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || true
  sleep 3
  echo -e "${GREEN}✓ Docker configured with insecure-registries: localhost:5000, ${REGISTRY_IP}:5000${NC}"
}

# ── Install Platform Tools ───────────────────────────────────
install_tools() {
  echo ""
  echo -e "${BLUE}→ Installing platform tools...${NC}"

  # Nixpacks (auto-detect builder)
  if command -v nixpacks &> /dev/null; then
    echo -e "${GREEN}✓ Nixpacks already installed$(nixpacks --version 2>/dev/null | head -1)${NC}"
  else
    echo -e "${YELLOW}→ Installing nixpacks...${NC}"
    curl -sSL https://nixpacks.com/install.sh | bash 2>/dev/null
    if command -v nixpacks &> /dev/null; then
      echo -e "${GREEN}✓ Nixpacks installed${NC}"
    else
      echo -e "${YELLOW}⚠ Nixpacks install failed — will auto-install on first build${NC}"
    fi
  fi

  # Cloudflared (Cloudflare Tunnel)
  if command -v cloudflared &> /dev/null; then
    echo -e "${GREEN}✓ Cloudflared already installed ($(cloudflared --version 2>/dev/null | head -1))${NC}"
  else
    echo -e "${YELLOW}→ Installing cloudflared...${NC}"
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64|amd64) CF_ARCH="amd64" ;;
      aarch64|arm64) CF_ARCH="arm64" ;;
      armv7l) CF_ARCH="arm" ;;
      *) CF_ARCH="amd64" ;; # fallback
    esac
    curl -sL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" && \
      chmod +x /usr/local/bin/cloudflared
    if command -v cloudflared &> /dev/null; then
      echo -e "${GREEN}✓ Cloudflared installed ($(cloudflared --version 2>/dev/null | head -1))${NC}"
    else
      echo -e "${YELLOW}⚠ Cloudflared install failed — configure manually later${NC}"
    fi
  fi
}

# ── Ensure Docker Compose ────────────────────────────────────
check_compose() {
  if docker compose version &> /dev/null; then
    echo -e "${GREEN}✓ Docker Compose available${NC}"
  elif command -v docker-compose &> /dev/null; then
    echo -e "${GREEN}✓ Docker Compose (standalone) available${NC}"
    # Create alias
    COMPOSE_CMD="docker-compose"
  else
    echo -e "${RED}✗ Docker Compose not found. Install it: https://docs.docker.com/compose/install/${NC}"
    exit 1
  fi
}

COMPOSE_CMD="docker compose"

# ── Generate Secrets ─────────────────────────────────────────
generate_secret() {
  openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | tr -dc 'a-f0-9' | head -c 64
}

# ── Main ─────────────────────────────────────────────────────

detect_os
install_docker
configure_docker_daemon
check_compose
install_tools

echo ""
echo -e "${BLUE}→ Setting up Click-Deploy in ${INSTALL_DIR}...${NC}"

# Create install directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Get source files — check if already present (e.g. running from cloned repo)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/docker-compose.yml" ] && [ -f "${SCRIPT_DIR}/Dockerfile" ]; then
  # Running from within existing project directory
  if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
    echo -e "${BLUE}→ Copying files from ${SCRIPT_DIR} to ${INSTALL_DIR}...${NC}"
    cp -r "${SCRIPT_DIR}/." "$INSTALL_DIR/"
  else
    echo -e "${GREEN}✓ Files already in ${INSTALL_DIR}${NC}"
  fi
elif [ -f "docker-compose.yml" ] && [ -f "Dockerfile" ]; then
  echo -e "${GREEN}✓ Files already present in ${INSTALL_DIR}${NC}"
elif command -v git &> /dev/null; then
  if [ -d ".git" ]; then
    echo -e "${BLUE}→ Updating existing installation...${NC}"
    git pull --quiet
  else
    echo -e "${BLUE}→ Cloning Click-Deploy...${NC}"
    git clone --depth 1 https://github.com/clickbitau/click-deploy.git . 2>/dev/null || {
      echo -e "${RED}✗ Git clone failed. Place the Click-Deploy files in ${INSTALL_DIR} and re-run.${NC}"
      exit 1
    }
  fi
else
  echo -e "${RED}✗ No source files found. Clone the repo to ${INSTALL_DIR} first.${NC}"
  exit 1
fi

# Generate .env if it doesn't exist
if [ ! -f .env ]; then
  echo -e "${BLUE}→ Generating .env with secure defaults...${NC}"

  AUTH_SECRET=$(generate_secret)
  ENCRYPTION_KEY=$(generate_secret)
  DB_PASSWORD=$(generate_secret | head -c 32)
  WEBHOOK_SECRET=$(generate_secret | head -c 32)

  # Detect public IP for BETTER_AUTH_URL
  PUBLIC_IP=$(curl -4 -s ifconfig.me 2>/dev/null || curl -4 -s icanhazip.com 2>/dev/null || echo "localhost")
  PORT=${PORT:-3000}

  cat > .env << EOF
# ============================================================
# Click-Deploy — Environment Configuration
# Generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================================

# ── Database Mode ──────────────────────────────────────────
# LOCAL (default): Uses a bundled PostgreSQL container.
#   COMPOSE_PROFILES=local-db activates the local db service.
#   POSTGRES_PASSWORD is the password for the local container.
#
# EXTERNAL: To use Supabase, Neon, RDS, etc:
#   1. Comment out COMPOSE_PROFILES and POSTGRES_PASSWORD
#   2. Uncomment and set DATABASE_URL
COMPOSE_PROFILES=local-db
POSTGRES_PASSWORD=${DB_PASSWORD}
# DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Auth — CHANGE BETTER_AUTH_URL if using a domain or reverse proxy
BETTER_AUTH_SECRET=${AUTH_SECRET}
BETTER_AUTH_URL=http://${PUBLIC_IP}:${PORT}

# SSH Key Encryption (AES-256-GCM)
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# GitHub Webhooks (optional — set when configuring auto-deploy)
GITHUB_WEBHOOK_SECRET=${WEBHOOK_SECRET}

# GitHub OAuth (optional — set for GitHub login)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# Supabase Realtime (optional — only if using external Supabase DB)
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Cloudflare Tunnels (optional)
# CLOUDFLARE_API_TOKEN=
# CLOUDFLARE_ACCOUNT_ID=

# Port (default 3000)
PORT=${PORT}
EOF

  chmod 600 .env
  echo -e "${GREEN}✓ .env generated with secure secrets${NC}"
else
  echo -e "${GREEN}✓ .env already exists, keeping existing config${NC}"
fi

# ── Build & Start ────────────────────────────────────────────
echo ""
echo -e "${BLUE}→ Building Click-Deploy (this may take 2-5 minutes)...${NC}"

$COMPOSE_CMD build --quiet 2>&1 || $COMPOSE_CMD build 2>&1

echo -e "${BLUE}→ Starting services...${NC}"
$COMPOSE_CMD up -d

# Wait for health (migrations + startup)
echo -e "${BLUE}→ Waiting for services to be ready (migrations + startup)...${NC}"
sleep 15

# Check status (look for the app container specifically)
if $COMPOSE_CMD ps app 2>/dev/null | grep -q "running\|Up"; then
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║     ⚡ Click-Deploy is running! ⚡       ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
  echo ""

  # Read port and IP from .env
  source .env 2>/dev/null
  APP_URL="${BETTER_AUTH_URL:-http://${PUBLIC_IP:-localhost}:${PORT:-3000}}"

  echo -e "  ${CYAN}Dashboard:${NC}  ${APP_URL}"
  echo -e "  ${CYAN}Install Dir:${NC} ${INSTALL_DIR}"
  echo ""
  echo -e "  ${YELLOW}Next steps:${NC}"
  echo -e "  1. Open ${APP_URL} and create your admin account"
  echo -e "  2. Add your first server node (Dashboard → Nodes)"
  echo -e "  3. Deploy Traefik & Registry (Dashboard → Settings → Infrastructure)"
  echo -e "  4. Create a project and deploy!"
  echo ""
  echo -e "  ${YELLOW}Useful commands:${NC}"
  echo -e "  cd ${INSTALL_DIR} && docker compose logs -f    ${BLUE}# View logs${NC}"
  echo -e "  cd ${INSTALL_DIR} && docker compose restart    ${BLUE}# Restart${NC}"
  echo -e "  cd ${INSTALL_DIR} && docker compose down       ${BLUE}# Stop${NC}"
  echo -e "  cd ${INSTALL_DIR} && docker compose pull && docker compose up -d  ${BLUE}# Update${NC}"
  echo ""
else
  echo -e "${RED}✗ Something went wrong. Check logs:${NC}"
  echo -e "  cd ${INSTALL_DIR} && docker compose logs"
  exit 1
fi
