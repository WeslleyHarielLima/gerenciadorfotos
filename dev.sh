#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${CYAN}[dev]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!]${NC}   $*"; }
err()  { echo -e "${RED}[erro]${NC} $*"; }

cleanup() {
  log "Encerrando serviços..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  docker compose -f "$ROOT/docker-compose.yml" down 2>/dev/null || true
  ok "Tudo parado."
}
trap cleanup EXIT INT TERM

# ── 0. Libera portas ocupadas ──────────────────────────────────
for PORT in 8000 3000; do
  PIDS=$(lsof -ti:"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    warn "Porta $PORT em uso — encerrando processo(s): $PIDS"
    kill $PIDS 2>/dev/null || true
    sleep 1
  fi
done

# ── 1. Docker Postgres ─────────────────────────────────────────
log "Subindo Postgres (Docker)..."
docker compose -f "$ROOT/docker-compose.yml" up -d

# Aguarda healthcheck
for i in $(seq 1 20); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' workflow_postgres 2>/dev/null || echo "missing")
  if [ "$STATUS" = "healthy" ]; then
    ok "Postgres saudável."
    break
  fi
  if [ "$i" -eq 20 ]; then
    err "Postgres não ficou saudável a tempo. Verifique: docker compose logs postgres"
    exit 1
  fi
  sleep 2
done

# ── 2. Backend Django + uvicorn ────────────────────────────────
log "Iniciando backend (http://localhost:8000)..."
log "  Admin: http://localhost:8000/admin  (admin / admin123)"
log "  API:   http://localhost:8000/api/docs"

cd "$BACKEND"
source .venv/bin/activate

export DJANGO_SETTINGS_MODULE=config.settings
export DB_PORT=5433

# Aplica migrações pendentes silenciosamente
python manage.py migrate --run-syncdb 2>&1 | grep -v "^$" | sed 's/^/  /' || true

uvicorn config.asgi:application --port 8000 --reload &
BACKEND_PID=$!

# Aguarda backend responder
for i in $(seq 1 15); do
  if curl -s -o /dev/null -w "%{http_code}" localhost:8000/api/docs | grep -q "200"; then
    ok "Backend pronto."
    break
  fi
  if [ "$i" -eq 15 ]; then
    err "Backend não respondeu. Verifique os logs acima."
    exit 1
  fi
  sleep 1
done

# ── 3. Frontend Next.js ────────────────────────────────────────
log "Iniciando frontend (http://localhost:3000)..."

cd "$FRONTEND"
npm run dev &
FRONTEND_PID=$!

# Aguarda frontend responder
for i in $(seq 1 20); do
  if curl -s -o /dev/null -w "%{http_code}" localhost:3000 | grep -q "200"; then
    ok "Frontend pronto."
    break
  fi
  sleep 2
done

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Workflow Studio rodando${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Login:  ${CYAN}http://localhost:3000${NC}"
echo -e "  Admin:  ${CYAN}http://localhost:8000/admin${NC}  (admin / admin123)"
echo -e "  API:    ${CYAN}http://localhost:8000/api/docs${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Pressione ${YELLOW}Ctrl+C${NC} para parar tudo."
echo ""

# Mantém o script vivo até Ctrl+C
wait
