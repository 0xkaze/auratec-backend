# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Auratec backend (Bun + Hono + Drizzle). Imagem de produção.
# Bun roda TS direto (resolve os paths `@/*` via tsconfig), então
# não há etapa de build — só instalar deps e servir.
# ──────────────────────────────────────────────────────────────

FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Deps + código.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# GLBs do seed (versionados em seed-assets/) são copiados pra uploads/objetos
# → ficam baked na imagem e "semeiam" o volume nomeado na 1ª subida. Uploads
# feitos em runtime persistem no mesmo volume.
# Permissões: roda como usuário não-root `bun` (já existe na imagem).
RUN mkdir -p uploads/objetos \
  && (cp -r seed-assets/objetos/. uploads/objetos/ 2>/dev/null || echo "WARN: seed-assets/objetos ausente — sem GLBs baked (commite seed-assets/)") \
  && chmod +x ./docker-entrypoint.sh \
  && chown -R bun:bun /app
USER bun

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
