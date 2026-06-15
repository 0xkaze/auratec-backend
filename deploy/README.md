# Auratec — Deploy (VPS + Docker + CI/CD)

Stack de produção: **Postgres + backend (Bun/Hono) + frontend (Next.js)** atrás do **Caddy** (HTTPS automático), tudo em Docker. As imagens são buildadas pelo **GitHub Actions** e publicadas no **GHCR**; o deploy é via **SSH** (`docker compose pull && up -d`).

```
internet ──▶ Caddy :443  ┌─ /api/*, /objetos/*, /health ─▶ backend:3001 ─▶ postgres:5432
            (HTTPS auto)  └─ resto ───────────────────────▶ frontend:3000
```

Um domínio só: o front responde em `/` e o back em `/api` (sem CORS cruzado, um cert).

---

## 1. Pré-requisitos na VPS (uma vez)

```bash
# Docker Engine + plugin compose (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # relogar depois

# pasta da stack
mkdir -p ~/auratec && cd ~/auratec
```

Aponte o **DNS** do domínio (registro A / AAAA) para o IP da VPS **antes** do primeiro deploy — o Caddy precisa resolver o domínio pra emitir o certificado TLS.

Crie o `~/auratec/.env` a partir de [`.env.prod.example`](.env.prod.example) e preencha (domínio, senha do Postgres, `JWT_SECRET`, etc.):

```bash
# no seu micro, copie o exemplo e edite, depois envie:
scp deploy/.env.prod.example usuario@vps:~/auratec/.env
# (edite os valores direto na VPS: nano ~/auratec/.env)
openssl rand -base64 64   # gere o JWT_SECRET
```

> O `compose.prod.yml` e o `Caddyfile` **não** precisam ser copiados à mão — o CI do backend envia automaticamente. Pro **primeiríssimo** deploy você pode enviar manualmente: `scp deploy/compose.prod.yml deploy/Caddyfile usuario@vps:~/auratec/`.

---

## 2. Secrets / variables no GitHub

Em **ambos** os repos (`auratec-backend` e `auratec-frontend`) → Settings → Secrets and variables → Actions:

**Secrets** (os dois repos):

| Secret | O quê |
|---|---|
| `SSH_HOST` | IP/host da VPS |
| `SSH_USER` | usuário SSH (o dono de `~/auratec`) |
| `SSH_PASSWORD` | senha SSH do usuário (a VPS precisa permitir `PasswordAuthentication yes`) |
| `SSH_PORT` | porta SSH (ex. `22`) |
| `GHCR_USER` | seu user do GitHub — **só se** os pacotes GHCR forem privados |
| `GHCR_PAT` | token com `read:packages` — **só se** privados (senão deixe em branco) |

**Variable** (só no `auratec-frontend`):

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://auratec.gmstech.dev` (igual ao `PUBLIC_URL` do `.env`) |

> `NEXT_PUBLIC_API_URL` é embutido no build do Next, por isso é uma *variable* (não secret) e precisa estar setada antes do build do front.
>
> Se preferir **pacotes públicos** no GHCR (dispensa `GHCR_USER`/`GHCR_PAT` na VPS): no GitHub, em cada package (`auratec-backend`/`auratec-frontend`) → Package settings → Change visibility → Public.

---

## 3. Deploy

Automático: **push na `main`** de cada repo dispara o workflow (build → GHCR → SSH → `compose up -d`).

- Backend: builda a imagem, envia `compose.prod.yml`+`Caddyfile` pra VPS e sobe tudo. As **migrations rodam sozinhas** no start do container (`docker-entrypoint.sh`).
- Frontend: builda com o `NEXT_PUBLIC_API_URL` e recria só o serviço `frontend`.

Rodar à mão (na VPS):

```bash
cd ~/auratec
docker compose -f compose.prod.yml --env-file .env pull
docker compose -f compose.prod.yml --env-file .env up -d
docker compose -f compose.prod.yml --env-file .env ps
```

---

## 4. Seed inicial (uma vez)

Cria o admin padrão + popula o catálogo de peças. Idempotente (não duplica admin).

```bash
cd ~/auratec
docker compose -f compose.prod.yml --env-file .env exec \
  -e SEED_ADMIN_EMAIL=voce@seudominio.com \
  -e SEED_ADMIN_PASSWORD='uma-senha-forte' \
  backend bun run src/db/seed.ts
```

Alternativa sem mexer no seed: defina `ADMIN_EMAILS` no `.env` — qualquer um desses emails vira admin ao se cadastrar/logar.

---

## 5. Operação

```bash
# logs
docker compose -f compose.prod.yml --env-file .env logs -f backend
docker compose -f compose.prod.yml --env-file .env logs -f caddy

# reiniciar um serviço
docker compose -f compose.prod.yml --env-file .env restart backend

# migrations manuais (normalmente automáticas no deploy)
docker compose -f compose.prod.yml --env-file .env exec backend bun run src/db/migrate.ts
```

### Backup do Postgres

```bash
# dump
docker compose -f compose.prod.yml --env-file .env exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > ~/auratec/backup-$(date +%F).sql.gz

# restore
gunzip -c backup-AAAA-MM-DD.sql.gz | \
  docker compose -f compose.prod.yml --env-file .env exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Cron diário (ex. 3h da manhã, mantém 7 dias):

```cron
0 3 * * * cd ~/auratec && docker compose -f compose.prod.yml --env-file .env exec -T postgres pg_dump -U auratec auratec | gzip > ~/auratec/backups/db-$(date +\%F).sql.gz && find ~/auratec/backups -name 'db-*.sql.gz' -mtime +7 -delete
```

### Dados persistentes (volumes)

- `pgdata` — banco
- `uploads` — GLBs enviados pelo admin (semeado na 1ª subida com os GLBs da imagem)
- `caddy_data` — certificados TLS

> Os GLBs do seed vêm "baked" na imagem do backend e populam o volume `uploads` **só na primeira criação** do volume. Pra re-semear: `docker volume rm auratec_uploads` e suba de novo (perde uploads feitos em runtime).
