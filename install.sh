#!/bin/sh
set -eu
umask 077

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p data backups
chmod 700 data backups

if [ -e .env ]; then
  printf '%s\n' 'Existing .env left unchanged.' >&2
  exit 0
fi

random_hex() {
  bytes=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(Number(process.argv[1])).toString('hex'))" "$bytes"
  else
    printf '%s\n' 'Node.js 22+ or openssl is required to generate secrets.' >&2
    exit 1
  fi
}

pg_password=$(random_hex 32)
trap 'unset pg_password' EXIT HUP INT TERM

cat >.env <<EOF
CAMPAIGNS_POSTGRES_PASSWORD=$pg_password
CAMPAIGNS_BIND_ADDRESS=127.0.0.1
CAMPAIGNS_HTTP_PORT=8080
CAMPAIGNS_TRUST_PROXY=false
EOF
chmod 600 .env
printf '%s\n' 'Local directories and .env were created. Secrets were not printed.' >&2
