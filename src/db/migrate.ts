/**
 * Runner customizado de migrations. Diferente do migrator default do
 * drizzle (que envolve TODAS as migrations numa transação só), este
 * roda CADA arquivo em transação separada — necessário pra DDL como
 * `ALTER TYPE ... ADD VALUE`, que só fica visível após COMMIT.
 *
 * Mantém compatibilidade com o tracking do drizzle (tabela
 * drizzle.__drizzle_migrations) pra que o `db:studio` etc. funcionem.
 *
 * Uso: `bun run src/db/migrate.ts` ou `bun run db:migrate`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import postgres from 'postgres'
import { env } from '@/env'

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations')

interface MigrationFile {
  tag: string
  filename: string
  hash: string
  statements: string[]
}

function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  return files.map((filename) => {
    const filepath = join(MIGRATIONS_DIR, filename)
    const raw = readFileSync(filepath, 'utf8')
    const hash = createHash('sha256').update(raw).digest('hex')
    const tag = filename.replace(/\.sql$/, '')
    // Drizzle usa "--> statement-breakpoint" como separador
    // Remove comments (linhas começadas com -- ANTES de qualquer SQL).
    // Mantém comentários inline. Cada chunk separado por breakpoint vira
    // um statement.
    const stripComments = (s: string) =>
      s
        .split('\n')
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim()
    const statements = raw
      .split(/-->\s*statement-breakpoint\s*\n?/i)
      .map((chunk) => stripComments(chunk))
      .filter((s) => s.length > 0)
    return { tag, filename, hash, statements }
  })
}

const main = async () => {
  console.log('🔄 Aplicando migrations (uma transação por arquivo)…')
  const client = postgres(env.DATABASE_URL, { max: 1 })

  // Cria schema/tabela do drizzle (compatível com o migrator nativo).
  await client`CREATE SCHEMA IF NOT EXISTS drizzle`
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `

  const applied = await client<{ hash: string }[]>`
    SELECT hash FROM drizzle.__drizzle_migrations
  `
  const appliedSet = new Set(applied.map((r) => r.hash))

  const migrations = loadMigrations()
  let count = 0

  for (const m of migrations) {
    if (appliedSet.has(m.hash)) {
      console.log(`  ⏭  ${m.tag} (já aplicada)`)
      continue
    }
    console.log(`  ▶️  ${m.tag} (${m.statements.length} stmt)`)

    // Roda em TRANSAÇÃO PRÓPRIA pra que DDL committable (ALTER TYPE
    // ADD VALUE) fique visível na próxima migration.
    await client.begin(async (tx) => {
      for (const stmt of m.statements) {
        await tx.unsafe(stmt)
      }
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${m.hash}, ${Date.now()})
      `
    })
    count++
  }

  await client.end()
  console.log(`✅ ${count} migration(s) aplicada(s).`)
}

main().catch((err) => {
  console.error('❌ Migration falhou:', err)
  process.exit(1)
})
