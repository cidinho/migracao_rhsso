#!/usr/bin/env bash
# Sobe o backend (NestJS) e o frontend (Nuxt) juntos, com a saída de cada um prefixada.
#   ./start.sh         desenvolvimento, com recarga automática
#   ./start.sh prod    build e execução em produção
# Ctrl+C encerra os dois.
set -euo pipefail
cd "$(dirname "$0")"

MODE=${1:-dev}
case "$MODE" in
  dev | prod) ;;
  *) echo "Uso: $0 [dev|prod]" >&2; exit 1 ;;
esac

command -v node >/dev/null || { echo "Node.js não encontrado no PATH." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm não encontrado. Instale com: npm install -g pnpm@9 (ou corepack enable)" >&2; exit 1; }
[ -f backend/.env ] || echo "Aviso: backend/.env não existe. Copie backend/.env.example e preencha (veja o README)." >&2

[ -d backend/node_modules ] || (cd backend && npm install)
[ -d frontend/node_modules ] || (cd frontend && pnpm install)

if [ "$MODE" = prod ]; then
  (cd backend && npm run build)
  (cd frontend && pnpm build)
fi

prefix() { while IFS= read -r line; do printf '[%s] %s\n' "$1" "$line"; done; }

stop_all() {
  trap - INT TERM EXIT
  if command -v taskkill >/dev/null 2>&1; then
    # Git Bash: os servidores node são processos nativos que não recebem os sinais do bash,
    # então a árvore de cada descendente do script é encerrada pelo PID do Windows.
    local winpids
    winpids=$(ps | awk -v root=$$ '
      NR > 1 { o = ($1 ~ /^[0-9]+$/) ? 0 : 1; parent[$(1+o)] = $(2+o); winpid[$(1+o)] = $(4+o) }
      END { for (p in parent) { q = p; while ((q in parent) && q != root) q = parent[q]; if (q == root && p != root) print winpid[p] } }')
    for w in $winpids; do taskkill //F //T //PID "$w" >/dev/null 2>&1 || true; done
  fi
  kill 0 2>/dev/null
}
trap stop_all INT TERM EXIT

if [ "$MODE" = dev ]; then
  (cd backend && npm run start:dev 2>&1 | prefix backend) &
  (cd frontend && pnpm dev 2>&1 | prefix frontend) &
else
  (cd backend && npm run start:prod 2>&1 | prefix backend) &
  # Em produção o Nuxt não lê o .env sozinho.
  if [ -f frontend/.env ]; then
    (cd frontend && node --env-file=.env .output/server/index.mjs 2>&1 | prefix frontend) &
  else
    (cd frontend && node .output/server/index.mjs 2>&1 | prefix frontend) &
  fi
fi

echo "Backend: http://127.0.0.1:3001/api · Frontend: http://localhost:3000 (portas padrão) · Ctrl+C para encerrar"
wait
