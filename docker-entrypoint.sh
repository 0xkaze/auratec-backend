#!/bin/sh
# Entrypoint de produção: aplica migrations (idempotente — pula as já
# aplicadas) e então sobe a API. O compose garante que o Postgres está
# saudável antes deste container iniciar (depends_on: service_healthy).
set -e

echo "▶ Aplicando migrations..."
bun run src/db/migrate.ts

# Auto-semeia o CATÁLOGO (insert-only — não toca em peças já configuradas).
# Sem criar admin padrão: em prod o admin sai do ADMIN_EMAILS. Falha aqui
# não derruba o boot da API.
echo "▶ Semeando catálogo (se faltar)..."
SEED_CATALOG_ONLY=true bun run src/db/seed.ts || echo "WARN: seed do catálogo falhou (segue assim mesmo)"

echo "▶ Subindo API..."
exec bun src/index.ts
