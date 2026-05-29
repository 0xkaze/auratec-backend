import { Hono } from 'hono'
import { z } from 'zod'
import { desc, eq, count } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { statSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/db/client'
import {
  users,
  projects,
  pieceCatalog,
  activityLogs,
  toPublicUser,
  PERMISSIONS,
  type Permission,
} from '@/db/schema'
import {
  requireAdmin,
  requireAuth,
  requirePerm,
  type AuthVariables,
} from '@/auth/middleware'
import { parseJsonBody, parseParams } from '@/lib/validate'
import { ok, fail, noContent } from '@/lib/http'
import {
  getSignupPolicy,
  getUserLimits,
  setSignupPolicy,
  setUserLimits,
} from '@/services/platform-settings'
import { logActivity } from '@/services/activity-log'

const idParam = z.object({ id: z.string().uuid() })

const permissionSchema = z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]])

const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.enum(['user', 'admin']).optional(),
  permissions: z.array(permissionSchema).optional(),
})

const signupPolicySchema = z.object({
  enabled: z.boolean(),
  requireApproval: z.boolean(),
  allowedDomains: z.array(z.string().toLowerCase().trim().min(1)),
})

const userLimitsSchema = z.object({
  maxProjects: z.number().int().min(-1).max(10_000),
  maxUploadMB: z.number().int().min(1).max(500),
})

export const adminRoutes = new Hono<{ Variables: AuthVariables }>()
adminRoutes.use('*', requireAuth)

/**
 * GET /admin/stats — números pro dashboard de admin. Qualquer user com
 * view_admin pode ver (e admin implícito).
 */
adminRoutes.get('/stats', requirePerm('view_admin'), async (c) => {
  const [userCount] = await db.select({ n: count() }).from(users)
  const [projectCount] = await db.select({ n: count() }).from(projects)
  const [pieceCount] = await db.select({ n: count() }).from(pieceCatalog)
  const outros = await db
    .select()
    .from(pieceCatalog)
    .where(eq(pieceCatalog.category, 'Outros'))
  const outrosTotal = outros.length
  const outrosConfigured = outros.filter(
    (p) =>
      p.dockAbove !== null ||
      p.dockBelow !== null ||
      (Array.isArray(p.hostSlots) && p.hostSlots.some((s) => s.targets.length > 0)),
  ).length
  return ok(c, {
    users: userCount?.n ?? 0,
    projects: projectCount?.n ?? 0,
    catalogPieces: pieceCount?.n ?? 0,
    outrosConfigured,
    outrosTotal,
  })
})

// ============================================================
//  Usuários
// ============================================================

/** GET /admin/users — lista todos os usuários. */
adminRoutes.get('/users', requirePerm('manage_users'), async (c) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt))
  return ok(c, rows.map(toPublicUser))
})

/** PATCH /admin/users/:id — atualizar nome, role ou permissions. */
adminRoutes.patch('/users/:id', requirePerm('manage_users'), async (c) => {
  const { id } = parseParams(c, idParam)
  const body = await parseJsonBody(c, updateUserSchema)
  const me = c.get('user')

  // Bloqueio: ninguém rebaixa a si mesmo (evita ficar sem admin) e
  // ninguém remove suas próprias perms de manage_users (mesma razão).
  if (id === me.sub) {
    if (body.role && body.role !== 'admin' && me.role === 'admin') {
      return fail(c, 'CANNOT_DEMOTE_SELF', 'Você não pode rebaixar a si mesmo', 400)
    }
    if (body.permissions && me.role !== 'admin' && !body.permissions.includes('manage_users')) {
      return fail(
        c,
        'CANNOT_REMOVE_OWN_PERM',
        'Você não pode remover sua própria permissão manage_users',
        400,
      )
    }
  }

  // Role só admin troca. Permissions qualquer manage_users pode.
  if (body.role !== undefined && me.role !== 'admin') {
    return fail(c, 'FORBIDDEN', 'Só admin pode alterar role de usuários', 403)
  }

  const [row] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()
  if (!row) return fail(c, 'NOT_FOUND', 'Usuário não encontrado', 404)
  logActivity({
    userId: me.sub,
    action: 'user.update',
    entityType: 'user',
    entityId: row.id,
    metadata: { name: row.name, changed: Object.keys(body) },
  })
  return ok(c, toPublicUser(row))
})

/** DELETE /admin/users/:id — remove (cascateia projetos). */
adminRoutes.delete('/users/:id', requirePerm('manage_users'), async (c) => {
  const { id } = parseParams(c, idParam)
  const me = c.get('user')
  if (id === me.sub) {
    return fail(c, 'CANNOT_DELETE_SELF', 'Você não pode deletar a si mesmo', 400)
  }
  const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id })
  if (result.length === 0) return fail(c, 'NOT_FOUND', 'Usuário não encontrado', 404)
  return noContent(c)
})

/** GET /admin/users/permissions — devolve catálogo de perms reconhecidas. */
adminRoutes.get('/users/permissions', requirePerm('manage_users'), async (c) => {
  return ok(c, {
    permissions: PERMISSIONS.map((key) => ({ key, label: permissionLabel(key) })),
  })
})

/** GET /admin/users/:id/projects — projetos de um usuário específico. */
adminRoutes.get('/users/:id/projects', requirePerm('manage_users'), async (c) => {
  const { id } = parseParams(c, idParam)
  const owner = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!owner) return fail(c, 'NOT_FOUND', 'Usuário não encontrado', 404)
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      pieceCount: sql<number>`jsonb_array_length(${projects.pieces})`.as('piece_count'),
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.ownerId, id))
    .orderBy(desc(projects.updatedAt))
  return ok(c, rows)
})

// ============================================================
//  Projetos (admin pode ver qualquer projeto)
// ============================================================

/** GET /admin/projects/:id — qualquer projeto + dados do dono. */
adminRoutes.get('/projects/:id', requirePerm('manage_users'), async (c) => {
  const { id } = parseParams(c, idParam)
  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) })
  if (!project) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)
  const owner = await db.query.users.findFirst({ where: eq(users.id, project.ownerId) })
  return ok(c, {
    ...project,
    owner: owner ? toPublicUser(owner) : null,
  })
})

function permissionLabel(perm: Permission): string {
  switch (perm) {
    case 'view_admin': return 'Acessar painel admin'
    case 'manage_users': return 'Gerenciar usuários e permissões'
    case 'manage_catalog': return 'Gerenciar catálogo de peças'
    case 'manage_settings': return 'Editar configurações da plataforma'
  }
}

// ============================================================
//  Settings
// ============================================================

/** GET /admin/settings — todos os settings agrupados. */
adminRoutes.get('/settings', requirePerm('view_admin'), async (c) => {
  const [signupPolicy, userLimits] = await Promise.all([
    getSignupPolicy(),
    getUserLimits(),
  ])
  return ok(c, { signupPolicy, userLimits })
})

/** PATCH /admin/settings — atualiza policy/limits parcialmente. */
adminRoutes.patch('/settings', requirePerm('manage_settings'), async (c) => {
  const schema = z.object({
    signupPolicy: signupPolicySchema.optional(),
    userLimits: userLimitsSchema.optional(),
  })
  const body = await parseJsonBody(c, schema)
  if (body.signupPolicy) await setSignupPolicy(body.signupPolicy)
  if (body.userLimits) await setUserLimits(body.userLimits)
  const [signupPolicy, userLimits] = await Promise.all([
    getSignupPolicy(),
    getUserLimits(),
  ])
  return ok(c, { signupPolicy, userLimits })
})

// ============================================================
//  System info (read-only)
// ============================================================

/** Calcula tamanho recursivo de um diretório. */
function dirSizeBytes(path: string): number {
  if (!existsSync(path)) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, entry.name)
    try {
      if (entry.isDirectory()) {
        total += dirSizeBytes(p)
      } else if (entry.isFile()) {
        total += statSync(p).size
      }
    } catch {
      // permissão / link quebrado — ignora
    }
  }
  return total
}

/** GET /admin/system-info — dados read-only do sistema. */
adminRoutes.get('/system-info', requirePerm('view_admin'), async (c) => {
  // DB health: faz um SELECT 1.
  let dbStatus: 'ok' | 'error' = 'ok'
  let dbError: string | null = null
  try {
    await db.execute(sql`SELECT 1`)
  } catch (err) {
    dbStatus = 'error'
    dbError = err instanceof Error ? err.message : String(err)
  }

  const uploadsPath = join(process.cwd(), 'uploads')
  const uploadsSizeBytes = dirSizeBytes(uploadsPath)

  const [pieceCount] = await db.select({ n: count() }).from(pieceCatalog)
  const [userCount] = await db.select({ n: count() }).from(users)
  const [projectCount] = await db.select({ n: count() }).from(projects)

  return ok(c, {
    version: process.env.npm_package_version ?? 'dev',
    runtime: {
      bun: typeof Bun !== 'undefined' ? Bun.version : null,
      node: process.versions.node,
      platform: process.platform,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    db: { status: dbStatus, error: dbError },
    storage: {
      uploadsPath,
      uploadsSizeBytes,
      uploadsSizeMB: +(uploadsSizeBytes / 1024 / 1024).toFixed(2),
    },
    counts: {
      users: userCount?.n ?? 0,
      projects: projectCount?.n ?? 0,
      catalogPieces: pieceCount?.n ?? 0,
    },
  })
})

// ============================================================
//  Logs de atividade
// ============================================================

/**
 * GET /admin/logs — lista logs de atividade (mais recentes primeiro).
 * Faz JOIN leve com users pra trazer nome/email de quem agiu.
 * Query params: ?limit=100 (default), ?action=project.create (filtro opcional).
 */
adminRoutes.get('/logs', requirePerm('view_admin'), async (c) => {
  const limitRaw = Number(c.req.query('limit') ?? '100')
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500)
  const actionFilter = c.req.query('action')?.trim()

  const rows = await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      projectId: activityLogs.projectId,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
      userId: activityLogs.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(actionFilter ? eq(activityLogs.action, actionFilter) : undefined)
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit)
  return ok(c, rows)
})

/**
 * Hard gate: tudo abaixo SÓ admin. (Mantido pra rotas que ainda não foram
 * migradas se aparecerem no futuro — atualmente vazio.)
 */
adminRoutes.use('/_admin-only/*', requireAdmin)
