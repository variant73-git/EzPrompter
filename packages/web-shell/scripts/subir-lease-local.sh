#!/usr/bin/env bash
# Sobe o ambiente do aceite do lease B (Task 14): dev server COM a concessão
# ligada + o proxy TLS local. Rodar de packages/web-shell.
#
# Pré-requisito (uma vez): mkcert instalado e o cert coringa gerado —
#   mkcert -install
#   mkcert "*.rt.localtest.me"
#
# Este script NÃO altera o `bun dev` normal: as três variáveis vivem só aqui,
# então a concessão fica ligada apenas quando você sobe por este caminho.
set -euo pipefail
cd "$(dirname "$0")/.."

CERT="_wildcard.rt.localtest.me.pem"
if [[ ! -f "$CERT" ]]; then
  echo "Falta o certificado ($CERT). Rode uma vez, aqui em packages/web-shell:"
  echo '  mkcert -install && mkcert "*.rt.localtest.me"'
  exit 1
fi

# Proxy TLS em segundo plano; derrubado ao sair.
XDG_DATA_HOME="/opt/homebrew/var/lib" HOME="/opt/homebrew/var/lib" \
  caddy run --config ./Caddyfile &
CADDY_PID=$!
trap 'kill "$CADDY_PID" 2>/dev/null || true' EXIT
echo "caddy (HTTPS :3443) no ar — pid $CADDY_PID"

# Dev server COM a concessão ligada (as três variáveis do plano).
export UNCRAFT_RUNTIME_LEASE=1
export UNCRAFT_RUNTIME_HOST_SUFFIX=rt.localtest.me
export UNCRAFT_RUNTIME_AUTHORITY_TEMPLATE="https://{host}:3443"
echo "dev server COM lease ligada — http://localhost:3030 (app) / https://<sessão>.rt.localtest.me:3443 (runtime)"
exec bun dev
