import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, count } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from '@/db/client'
import { projects, projectVersions } from '@/db/schema'
import { requireAuth, type AuthVariables } from '@/auth/middleware'
import { parseJsonBody, parseParams } from '@/lib/validate'
import { ok, created, fail, noContent } from '@/lib/http'
import { getUserLimits } from '@/services/platform-settings'
import { logActivity } from '@/services/activity-log'

const piecesSchema = z.array(z.unknown())

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Opcional: quando omitido (ex.: auto-save), preserva a descrição atual.
  description: z.string().max(2000).optional(),
  pieces: piecesSchema,
  /** dataURL JPEG/PNG do preview. Cap ~700KB pra evitar abuso. NULL/omitido = sem thumb. */
  thumbnail: z.string().max(700_000).nullable().optional(),
  /** Quando true, o save é um auto-save (gera versão marcada como automática). */
  isAuto: z.boolean().optional(),
})

const idParam = z.object({ id: z.string().uuid() })

/** Mantém no máximo N versões por projeto (poda as mais antigas). */
const MAX_VERSIONS_PER_PROJECT = 20

/** Gera um slug curto url-safe pra compartilhamento. */
function genShareId(): string {
  return randomBytes(9).toString('base64url') // ~12 chars
}

/** Cria um snapshot de versão e poda o histórico além do limite. */
async function snapshotVersion(opts: {
  projectId: string
  pieces: unknown[]
  thumbnail: string | null
  isAuto: boolean
}) {
  await db.insert(projectVersions).values({
    projectId: opts.projectId,
    pieces: opts.pieces,
    thumbnail: opts.thumbnail,
    isAuto: opts.isAuto,
  })
  // Poda: mantém só as MAX_VERSIONS_PER_PROJECT mais recentes.
  const all = await db
    .select({ id: projectVersions.id })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, opts.projectId))
    .orderBy(desc(projectVersions.createdAt))
  const toDelete = all.slice(MAX_VERSIONS_PER_PROJECT)
  for (const v of toDelete) {
    await db.delete(projectVersions).where(eq(projectVersions.id, v.id))
  }
}

export const projectsRoutes = new Hono<{ Variables: AuthVariables }>()
projectsRoutes.use('*', requireAuth)

/** GET /projects — lista projetos do usuário, mais recentes primeiro. */
projectsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, user.sub))
    .orderBy(desc(projects.updatedAt))
  return ok(c, rows)
})

/** POST /projects — cria projeto novo. */
projectsRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await parseJsonBody(c, upsertSchema)

  // Limite de projetos por user (admin ignora). -1 = ilimitado.
  if (user.role !== 'admin') {
    const limits = await getUserLimits()
    if (limits.maxProjects > 0) {
      const [row] = await db
        .select({ n: count() })
        .from(projects)
        .where(eq(projects.ownerId, user.sub))
      const n = row?.n ?? 0
      if (n >= limits.maxProjects) {
        return fail(
          c,
          'PROJECT_LIMIT_REACHED',
          `Limite de ${limits.maxProjects} projetos atingido. Apague algum antes de criar outro.`,
          403,
        )
      }
    }
  }

  const [row] = await db
    .insert(projects)
    .values({
      ownerId: user.sub,
      name: body.name,
      description: body.description ?? '',
      pieces: body.pieces,
      thumbnail: body.thumbnail ?? null,
    })
    .returning()
  if (!row) return fail(c, 'INSERT_FAILED', 'Falha ao criar projeto', 500)

  await snapshotVersion({
    projectId: row.id,
    pieces: body.pieces,
    thumbnail: body.thumbnail ?? null,
    isAuto: false,
  })
  logActivity({
    userId: user.sub,
    action: 'project.create',
    entityType: 'project',
    entityId: row.id,
    projectId: row.id,
    metadata: { name: row.name, pieceCount: body.pieces.length },
  })
  return created(c, row)
})

/** GET /projects/:id — busca por ID, só se for do dono. */
projectsRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const row = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, user.sub)),
  })
  if (!row) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)
  return ok(c, row)
})

/** PUT /projects/:id — atualiza nome/descrição/peças. Sobrescreve + versiona. */
projectsRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const body = await parseJsonBody(c, upsertSchema)

  const [row] = await db
    .update(projects)
    .set({
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      pieces: body.pieces,
      ...(body.thumbnail !== undefined ? { thumbnail: body.thumbnail } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.sub)))
    .returning()

  if (!row) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)

  await snapshotVersion({
    projectId: row.id,
    pieces: body.pieces,
    thumbnail: row.thumbnail ?? null,
    isAuto: body.isAuto ?? false,
  })
  // Auto-saves não poluem o log; só saves manuais.
  if (!body.isAuto) {
    logActivity({
      userId: user.sub,
      action: 'project.update',
      entityType: 'project',
      entityId: row.id,
      projectId: row.id,
      metadata: { name: row.name, pieceCount: body.pieces.length },
    })
  }
  return ok(c, row)
})

/** DELETE /projects/:id */
projectsRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const [row] = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.sub)))
    .returning({ id: projects.id, name: projects.name })
  if (!row) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)
  logActivity({
    userId: user.sub,
    action: 'project.delete',
    entityType: 'project',
    entityId: row.id,
    metadata: { name: row.name },
  })
  return noContent(c)
})

// ============================================================
//  Versões
// ============================================================

/** GET /projects/:id/versions — histórico de versões (metadata, sem pieces pesado). */
projectsRoutes.get('/:id/versions', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const owner = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, user.sub)),
  })
  if (!owner) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)

  const rows = await db
    .select({
      id: projectVersions.id,
      thumbnail: projectVersions.thumbnail,
      isAuto: projectVersions.isAuto,
      label: projectVersions.label,
      createdAt: projectVersions.createdAt,
    })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, id))
    .orderBy(desc(projectVersions.createdAt))
  return ok(c, rows)
})

/** POST /projects/:id/versions/:versionId/restore — restaura uma versão. */
projectsRoutes.post('/:id/versions/:versionId/restore', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const versionId = c.req.param('versionId')

  const owner = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, user.sub)),
  })
  if (!owner) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)

  const version = await db.query.projectVersions.findFirst({
    where: and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, id)),
  })
  if (!version) return fail(c, 'NOT_FOUND', 'Versão não encontrada', 404)

  const [row] = await db
    .update(projects)
    .set({ pieces: version.pieces, thumbnail: version.thumbnail, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning()

  // Snapshot do estado restaurado pra não perder o ponto atual.
  await snapshotVersion({
    projectId: id,
    pieces: version.pieces,
    thumbnail: version.thumbnail,
    isAuto: false,
  })
  logActivity({
    userId: user.sub,
    action: 'project.restore',
    entityType: 'project',
    entityId: id,
    projectId: id,
    metadata: { versionId },
  })
  return ok(c, row)
})

// ============================================================
//  Compartilhamento
// ============================================================

/** POST /projects/:id/share — habilita link público e devolve o shareId. */
projectsRoutes.post('/:id/share', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, user.sub)),
  })
  if (!existing) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)

  const shareId = existing.shareId ?? genShareId()
  const [row] = await db
    .update(projects)
    .set({ shareId, isPublic: true, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning({ shareId: projects.shareId, isPublic: projects.isPublic })

  logActivity({
    userId: user.sub,
    action: 'project.share',
    entityType: 'project',
    entityId: id,
    projectId: id,
  })
  return ok(c, row)
})

/** DELETE /projects/:id/share — revoga o compartilhamento. */
projectsRoutes.delete('/:id/share', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const [row] = await db
    .update(projects)
    .set({ isPublic: false, updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.sub)))
    .returning({ id: projects.id })
  if (!row) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)
  return ok(c, { isPublic: false })
})
