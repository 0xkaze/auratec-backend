#!/bin/sh
# Entrypoint de produção: aplica migrations (idempotente — pula as já
# aplicadas) e então sobe a API. O compose garante que o Postgres está
# saudável antes deste container iniciar (depends_on: service_healthy).
set -e

echo "▶ Aplicando migrations..."
bun run src/db/migrate.ts

echo "▶ Subindo API..."
exec bun src/index.ts
