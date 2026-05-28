# Auratec Backend

API HTTP do Auratec — autenticação, projetos, configs de peças e admin.

## Stack

- **Runtime**: [Bun](https://bun.sh) ≥ 1.3 (TypeScript nativo, sem build step em dev)
- **Framework**: [Hono](https://hono.dev) (tree-shakeable, edge-friendly)
- **DB**: PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team) (type-safe, sem code generation)
- **Validação**: [Zod](https://zod.dev)
- **Auth**: JWT (HS256, via [jose](https://github.com/panva/jose)) + Argon2id (via [@node-rs/argon2](https://github.com/napi-rs/node-rs/tree/main/packages/argon2))

## Setup local

```bash
# 1. Instalar deps
bun install

# 2. Copiar .env.example pra .env e gerar JWT_SECRET
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')" >> .env

# 3. Subir Postgres (porta 5433, pra não conflitar com PG local na 5432)
docker compose up -d

# 4. Aplicar migrations
bun run db:migrate

# 5. Seed: cria admin padrão + popula catálogo de peças
bun run db:seed

# 6. Subir o servidor
bun run dev
```

API sobe em `http://localhost:3001`. Health check em `/health`.

## Credenciais default (após seed)

```
admin@auratec.local / changeme123
```

⚠️ **Trocar em produção**. Pra mudar no seed, exporta `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` antes de rodar `db:seed`.

## Scripts

| Comando | O que faz |
|---------|-----------|
| `bun run dev` | Servidor com hot-reload |
| `bun run start` | Servidor sem hot (uso em prod) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run db:generate` | Gera migrations a partir do schema |
| `bun run db:migrate` | Aplica migrations pendentes |
| `bun run db:push` | Push direto do schema (só em dev, sem versionamento) |
| `bun run db:studio` | Abre Drizzle Studio (UI web no DB) |
| `bun run db:seed` | Cria admin + popula catálogo |

## Estrutura

```
src/
├── index.ts              # Hono app + Bun.serve
├── env.ts                # Validação de env (Zod)
├── db/
│   ├── client.ts         # Pool Postgres + Drizzle instance
│   ├── migrate.ts        # Runner de migrations (one-shot)
│   ├── seed.ts           # Seed inicial
│   ├── migrations/       # SQLs gerados pelo drizzle-kit
│   └── schema/
│       ├── index.ts      # Barrel de schemas
│       ├── users.ts
│       ├── projects.ts
│       ├── piece-configs.ts
│       └── piece-catalog.ts
├── auth/
│   ├── password.ts       # Argon2id
│   ├── jwt.ts            # Sign / verify JWT (jose)
│   └── middleware.ts     # requireAuth / requireAdmin
├── lib/
│   ├── http.ts           # Helpers de response (envelope { ok, data | error })
│   └── validate.ts       # parseJsonBody / parseQuery / parseParams (Zod)
└── routes/
    ├── auth.ts           # /api/auth/{register,login,me}
    ├── projects.ts       # /api/projects (CRUD do usuário)
    ├── piece-configs.ts  # /api/piece-configs (upsert por tipo de peça)
    ├── piece-catalog.ts  # /api/piece-catalog (público + admin pra CRUD)
    └── admin.ts          # /api/admin/{stats,users}
```

## Envelope de response

Toda resposta segue o mesmo shape — facilita o cliente:

```ts
// Sucesso
{ "ok": true, "data": <T> }

// Erro
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Token ausente" } }
```

## Endpoints

### Auth
- `POST /api/auth/register` — { name, email, password } → { user, token }
- `POST /api/auth/login` — { email, password } → { user, token }
- `GET /api/auth/me` — header `Authorization: Bearer <token>` → { user }

### Projects (auth required)
- `GET /api/projects`
- `POST /api/projects` — { name, description, pieces }
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`

### Piece configs (auth required)
- `GET /api/piece-configs` → mapa `{ [pieceType]: { snapPose, outputSnap } }`
- `GET /api/piece-configs/:type`
- `PUT /api/piece-configs/:type` — upsert
- `DELETE /api/piece-configs/:type`

### Piece catalog
- `GET /api/piece-catalog` (auth) — só peças ativas
- `GET /api/piece-catalog/all` (admin) — inclusive inativas
- `POST /api/piece-catalog` (admin)
- `PATCH /api/piece-catalog/:id` (admin)
- `DELETE /api/piece-catalog/:id` (admin)

### Admin (admin required)
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`

## Troubleshooting

**"role auratec does not exist"** ao rodar migrate:
- Outra instância de Postgres tá ocupando a porta 5432 do host. Por isso o docker-compose mapeia pra 5433 (e o .env aponta pra `localhost:5433`).

**`bun: command not found`** ao rodar `bun run db:migrate` dentro de outro script:
- Bun precisa estar no PATH do shell que executa o script. Adicione `export PATH="$HOME/.bun/bin:$PATH"` no `~/.zshrc` ou `~/.bashrc`.

**JWT errors** após reiniciar:
- Se você gerar um JWT_SECRET novo, todos os tokens antigos ficam inválidos (esperado). Faça logout/login.
