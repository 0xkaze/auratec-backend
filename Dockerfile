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

# Deps + código (uploads/objetos são baked aqui pra "semear" o volume
# nomeado na primeira subida; uploads em runtime persistem no volume).
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Permissões: roda como usuário não-root `bun` (já existe na imagem).
RUN mkdir -p uploads/objetos \
  && chmod +x ./docker-entrypoint.sh \
  && chown -R bun:bun /app
USER bun

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
