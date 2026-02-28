#!/usr/bin/env bash
# Waitron self-hosted setup script
# Usage: ./scripts/setup.sh

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[waitron]${NC} $*"; }
warn()  { echo -e "${YELLOW}[waitron]${NC} $*"; }
error() { echo -e "${RED}[waitron]${NC} $*" >&2; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────
command -v docker  >/dev/null 2>&1 || error "Docker is required. Install from https://docs.docker.com/get-docker/"
command -v docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || error "Docker Compose is required."

# ── .env setup ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "Creating .env from .env.example..."
  cp .env.example .env

  # Generate a random JWT_SECRET
  if command -v openssl >/dev/null 2>&1; then
    JWT_SECRET=$(openssl rand -hex 64)
    sed -i "s/replace-me-with-a-long-random-secret/${JWT_SECRET}/" .env
    info "Generated JWT_SECRET."
  else
    warn "openssl not found — please set JWT_SECRET manually in .env before continuing."
  fi

  warn ""
  warn "  IMPORTANT: Edit .env before continuing:"
  warn "   - Set POSTGRES_PASSWORD to a strong password"
  warn "   - Set NEXT_PUBLIC_API_URL to your server's public URL (e.g. https://api.yourdomain.com)"
  warn "   - Optionally set STRIPE_SECRET_KEY and PAYMENT_PROVIDER=stripe"
  warn ""
  read -r -p "  Press Enter once you've edited .env, or Ctrl+C to abort..."
fi

# ── Build & start ────────────────────────────────────────────────────────────
info "Building and starting services..."
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

info "Waiting for services to be healthy..."
sleep 5

info ""
info "  ✅  Waitron is running!"
info "      Dashboard: http://localhost:\${WEB_PORT:-3000}"
info "      API:       http://localhost:\${API_PORT:-3001}"
info ""
info "  Run 'docker compose -f docker-compose.prod.yml logs -f' to follow logs."
info "  Run 'docker compose -f docker-compose.prod.yml down' to stop."
