import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '@/db/client'
import { users, passwordResets, toPublicUser } from '@/db/schema'
import { hashPassword, verifyPassword } from '@/auth/password'
import { signAccessToken } from '@/auth/jwt'
import { requireAuth, type AuthVariables } from '@/auth/middleware'
import { resolveInitialRole, isAdminEmail } from '@/auth/admin-emails'
import { parseJsonBody } from '@/lib/validate'
import { ok, created, fail } from '@/lib/http'
import { checkSignupAllowed } from '@/services/platform-settings'
import { env } from '@/env'

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutos

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
})

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(200),
})

export const authRoutes = new Hono<{ Variables: AuthVariables }>()

/**
 * POST /auth/register
 * Cria usuário com role 'user' e devolve token + dados públicos.
 */
authRoutes.post('/register', async (c) => {
  const body = await parseJsonBody(c, registerSchema)

  // Admins (via ADMIN_EMAILS env) ignoram a política de signup —
  // garante que sempre dá pra bootstrap o painel mesmo com signup off.
  if (!isAdminEmail(body.email)) {
    const rejection = await checkSignupAllowed(body.email)
    if (rejection) {
      return fail(c, 'SIGNUP_DISABLED', rejection, 403)
    }
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, body.email) })
  if (existing) {
    return fail(c, 'EMAIL_TAKEN', 'Email já cadastrado', 409)
  }

  const passwordHash = await hashPassword(body.password)
  // Role inicial: se o email tá na lista ADMIN_EMAILS, já entra como admin.
  // Caso contrário, 'user' (default do schema).
  const role = resolveInitialRole(body.email)
  const [user] = await db
    .insert(users)
    .values({ name: body.name, email: body.email, passwordHash, role })
    .returning()
  if (!user) {
    return fail(c, 'INSERT_FAILED', 'Falha ao criar usuário', 500)
  }

  const token = await signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    permissions: user.permissions,
  })
  return created(c, { user: toPublicUser(user), token })
})

/**
 * POST /auth/login
 * Verifica senha e devolve token + dados públicos.
 */
authRoutes.post('/login', async (c) => {
  const body = await parseJsonBody(c, loginSchema)

  let user = await db.query.users.findFirst({ where: eq(users.email, body.email) })
  if (!user) {
    // Mesma mensagem pra senha errada vs email não existente — não
    // queremos vazar quais emails existem no sistema.
    return fail(c, 'INVALID_CREDENTIALS', 'Email ou senha incorretos', 401)
  }

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) {
    return fail(c, 'INVALID_CREDENTIALS', 'Email ou senha incorretos', 401)
  }

  // Auto-promove pra admin se o email tá na lista ADMIN_EMAILS e o
  // usuário ainda não é admin. Permite adicionar admins via env depois
  // que o user já existe — basta logar de novo. Idempotente.
  if (user.role !== 'admin' && isAdminEmail(user.email)) {
    const [promoted] = await db
      .update(users)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning()
    if (promoted) user = promoted
  }

  const token = await signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    permissions: user.permissions,
  })
  return ok(c, { user: toPublicUser(user), token })
})

/**
 * GET /auth/me
 * Retorna o usuário do token. Útil pro front hidratar estado de auth.
 */
authRoutes.get('/me', requireAuth, async (c) => {
  const claims = c.get('user')
  const user = await db.query.users.findFirst({ where: eq(users.id, claims.sub) })
  if (!user) {
    return fail(c, 'USER_NOT_FOUND', 'Usuário não existe mais', 404)
  }
  return ok(c, toPublicUser(user))
})

const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
})

/**
 * PATCH /auth/me
 * Atualiza dados básicos do próprio usuário (nome). Email e role ficam
 * fora — email exige fluxo de verificação, role só admin pode mudar.
 */
authRoutes.patch('/me', requireAuth, async (c) => {
  const claims = c.get('user')
  const body = await parseJsonBody(c, updateMeSchema)
  if (Object.keys(body).length === 0) {
    return fail(c, 'NO_CHANGES', 'Nada pra atualizar', 400)
  }
  const [user] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, claims.sub))
    .returning()
  if (!user) return fail(c, 'NOT_FOUND', 'Usuário não encontrado', 404)
  return ok(c, toPublicUser(user))
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
})

/**
 * POST /auth/me/password
 * Troca de senha. Valida a senha atual antes de aceitar a nova.
 */
authRoutes.post('/me/password', requireAuth, async (c) => {
  const claims = c.get('user')
  const body = await parseJsonBody(c, changePasswordSchema)
  const user = await db.query.users.findFirst({ where: eq(users.id, claims.sub) })
  if (!user) return fail(c, 'USER_NOT_FOUND', 'Usuário não encontrado', 404)

  const valid = await verifyPassword(body.currentPassword, user.passwordHash)
  if (!valid) {
    return fail(c, 'INVALID_PASSWORD', 'Senha atual incorreta', 401)
  }
  const newHash = await hashPassword(body.newPassword)
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, user.id))
  return ok(c, { changed: true })
})

// ============================================================
//  Password reset (forgot + reset)
// ============================================================

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
})

/**
 * POST /auth/forgot-password
 * Sempre devolve 200 mesmo quando o email não existe — evita oráculo
 * de enumeração. Quando o user existe, gera um token (32 bytes hex),
 * guarda só o hash no DB, e loga o link de reset no console do
 * backend. Em dev (NODE_ENV !== 'production') também devolve o link
 * na resposta pra facilitar teste sem SMTP configurado.
 */
authRoutes.post('/forgot-password', async (c) => {
  const body = await parseJsonBody(c, forgotPasswordSchema)
  const user = await db.query.users.findFirst({ where: eq(users.email, body.email) })

  let devLink: string | null = null
  if (user) {
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = sha256Hex(rawToken)
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
    await db.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt })

    const link = `${env.FRONTEND_URL}/auth/reset-password?token=${rawToken}`
    // TODO: enviar por email quando SMTP estiver configurado.
    console.log(`[auth] reset link pra ${user.email}: ${link}`)
    if (env.NODE_ENV !== 'production') {
      devLink = link
    }
  }

  return ok(c, {
    sent: true,
    message: 'Se o email existir, enviaremos instruções de recuperação.',
    ...(devLink ? { devLink } : {}),
  })
})

const resetPasswordSchema = z.object({
  token: z.string().min(20).max(128),
  newPassword: z.string().min(8).max(200),
})

/**
 * POST /auth/reset-password
 * Consome um token válido (não expirado, não usado) e troca a senha.
 * Token é hasheado antes de comparar (igual ao guardado).
 */
authRoutes.post('/reset-password', async (c) => {
  const body = await parseJsonBody(c, resetPasswordSchema)
  const tokenHash = sha256Hex(body.token)

  const reset = await db.query.passwordResets.findFirst({
    where: and(
      eq(passwordResets.tokenHash, tokenHash),
      isNull(passwordResets.usedAt),
      gt(passwordResets.expiresAt, new Date()),
    ),
  })
  if (!reset) {
    return fail(c, 'INVALID_TOKEN', 'Token inválido ou expirado', 400)
  }

  const newHash = await hashPassword(body.newPassword)
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, reset.userId))
    await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, reset.id))
  })

  return ok(c, { reset: true })
})
