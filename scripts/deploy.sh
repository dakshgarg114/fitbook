#!/usr/bin/env bash
# Build and (re)start Fitbook. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm build
# Migrations run automatically when the server starts.

if pm2 describe fitbook >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save
sleep 2
curl -fsS http://127.0.0.1:4310/healthz && echo " fitbook is up"
