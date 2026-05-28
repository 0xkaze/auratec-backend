import { z } from 'zod'

/**
 * Schema do ambiente. Tudo é validado UMA VEZ no boot — se faltar algo
 * ou estiver em formato inválido, o servidor não sobe e a mensagem
 * aponta exatamente o que tá errado.
 *
 * Nunca importe `process.env` diretamente em outros lugares; sempre
 * use `env` exportado daqui. Assim os tipos ficam corretos e qualquer
 * variável nova é centralmente documentada.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres://')).or(z.string().startsWith('postgresql://')),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter no mínimo 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('7d'),
  /**
   * Lista (vírgula-separada) de emails que ganham papel `admin`
   * automaticamente ao se cadastrar OU ao logar (idempotente). Permite
   * controlar admins via env sem precisar de UI/migration.
   * Ex: ADMIN_EMAILS=guilherme@auratec.local,outro@auratec.local
   */
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Origem pública do frontend — usada pra montar links em emails (ex.: reset de senha). */
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('\n❌ Variáveis de ambiente inválidas:')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  }
  console.error('\nCopie .env.example pra .env e preencha.\n')
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
