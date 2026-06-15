# Auratec — Deploy (VPS + Docker + CI/CD)

Stack de produção: **Postgres + backend (Bun/Hono) + frontend (Next.js)** atrás do **Caddy** (HTTPS automático), tudo em Docker. **Sem registry**: o GitHub Actions empacota o código e envia por **scp**; a **VPS builda** com `docker compose up -d --build`. Sem GHCR, sem credencial de registry/Git na VPS.

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

O usuário SSH precisa estar no grupo `docker` (`sudo usermod -aG docker $USER`) pra rodar o compose sem sudo.

Crie o `~/auratec/.env` a partir de [`.env.prod.example`](.env.prod.example) e preencha (domínio, senha do Postgres, `JWT_SECRET`, etc.) — **uma vez, à mão** (nunca vai pro git):

```bash
# no seu micro, copie o exemplo e edite, depois envie:
scp deploy/.env.prod.example usuario@vps:~/auratec/.env
# (edite os valores direto na VPS: nano ~/auratec/.env)
openssl rand -base64 64   # gere o JWT_SECRET
```

> O **código** (compose, Caddyfile, Dockerfiles, etc.) é enviado pelo CI a cada push — você não copia nada à mão além do `.env`.

---

## 2. Secrets / variables no GitHub

Em **ambos** os repos (`auratec-backend` e `auratec-frontend`) → Settings → Secrets and variables → Actions:

**Secrets** (iguais nos dois repos — só SSH, nada de registry):

| Secret | O quê |
|---|---|
| `SSH_HOST` | IP/host da VPS |
| `SSH_USER` | usuário SSH (no grupo `docker`, dono de `~/auratec`) |
| `SSH_PASSWORD` | senha SSH do usuário (a VPS precisa de `PasswordAuthentication yes`) |
| `SSH_PORT` | porta SSH (ex. `22`) |

> Não há secret de registry nem variable do front: o `NEXT_PUBLIC_API_URL` é buildado na VPS a partir do `PUBLIC_URL` do `~/auratec/.env`.

---

## 3. Deploy

Automático: **push na `main`** de cada repo dispara o workflow (empacota → scp → VPS builda → `compose up -d --build`).

- **Backend**: envia o código pra `~/auratec/backend`, sobe `postgres` + `caddy` + `backend`. As **migrations rodam sozinhas** no start do container (`docker-entrypoint.sh`).
- **Frontend**: envia o código pra `~/auratec/frontend`, builda com o `NEXT_PUBLIC_API_URL` (do `.env`) e recria só o serviço `frontend`.

> **Ordem no 1º deploy:** rode o **backend primeiro** (ele cria a stack: compose, Caddy, Postgres). Depois o frontend. Pushes seguintes podem ser em qualquer ordem.

Rodar à mão (na VPS), equivalente ao que o CI faz:

```bash
cd ~/auratec/backend/deploy
docker compose -f compose.prod.yml --env-file ~/auratec/.env up -d --build
docker compose -f compose.prod.yml --env-file ~/auratec/.env ps
```

---

## 4. Seed inicial (uma vez)

Cria o admin padrão + popula o catálogo de peças. Idempotente (não duplica admin).

```bash
cd ~/auratec/backend/deploy
docker compose -f compose.prod.yml --env-file ~/auratec/.env exec \
  -e SEED_ADMIN_EMAIL=voce@seudominio.com \
  -e SEED_ADMIN_PASSWORD='uma-senha-forte' \
  backend bun run src/db/seed.ts
```

Alternativa sem mexer no seed: defina `ADMIN_EMAILS` no `.env` — qualquer um desses emails vira admin ao se cadastrar/logar.

---

## 5. Operação

```bash
# logs
docker compose -f compose.prod.yml --env-file ~/auratec/.env logs -f backend
docker compose -f compose.prod.yml --env-file ~/auratec/.env logs -f caddy

# reiniciar um serviço
docker compose -f compose.prod.yml --env-file ~/auratec/.env restart backend

# migrations manuais (normalmente automáticas no deploy)
docker compose -f compose.prod.yml --env-file ~/auratec/.env exec backend bun run src/db/migrate.ts
```

### Backup do Postgres

```bash
# dump
docker compose -f compose.prod.yml --env-file ~/auratec/.env exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > ~/auratec/backup-$(date +%F).sql.gz

# restore
gunzip -c backup-AAAA-MM-DD.sql.gz | \
  docker compose -f compose.prod.yml --env-file ~/auratec/.env exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Cron diário (ex. 3h da manhã, mantém 7 dias):

```cron
0 3 * * * cd ~/auratec/backend/deploy && docker compose -f compose.prod.yml --env-file ~/auratec/.env exec -T postgres pg_dump -U auratec auratec | gzip > ~/auratec/backups/db-$(date +\%F).sql.gz && find ~/auratec/backups -name 'db-*.sql.gz' -mtime +7 -delete
```

### Dados persistentes (volumes)

- `pgdata` — banco
- `uploads` — GLBs enviados pelo admin (semeado na 1ª subida com os GLBs da imagem)
- `caddy_data` — certificados TLS

> Os GLBs do seed vêm "baked" na imagem do backend e populam o volume `uploads` **só na primeira criação** do volume. Pra re-semear: `docker volume rm auratec_uploads` e suba de novo (perde uploads feitos em runtime).
