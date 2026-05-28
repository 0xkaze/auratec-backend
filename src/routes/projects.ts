import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, count } from 'drizzle-orm'
import { db } from '@/db/client'
import { projects } from '@/db/schema'
import { requireAuth, type AuthVariables } from '@/auth/middleware'
import { parseJsonBody, parseParams } from '@/lib/validate'
import { ok, created, fail, noContent } from '@/lib/http'
import { getUserLimits } from '@/services/platform-settings'

const piecesSchema = z.array(z.unknown())

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  pieces: piecesSchema,
  /** dataURL JPEG/PNG do preview. Cap ~700KB pra evitar abuso. NULL/omitido = sem thumb. */
  thumbnail: z.string().max(700_000).nullable().optional(),
})

const idParam = z.object({ id: z.string().uuid() })

export const projectsRoutes = new Hono<{ Variables: AuthVariables }>()
projectsRoutes.use('*', requireAuth)

/**
 * GET /projects — lista projetos do usuário, mais recentes primeiro.
 */
projectsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, user.sub))
    .orderBy(desc(projects.updatedAt))
  return ok(c, rows)
})

/**
 * POST /projects — cria um projeto novo. O front gera o ID pra match
 * com o sistema antigo do localStorage; aqui geramos um UUID novo.
 */
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
      description: body.description,
      pieces: body.pieces,
      thumbnail: body.thumbnail ?? null,
    })
    .returning()
  if (!row) return fail(c, 'INSERT_FAILED', 'Falha ao criar projeto', 500)
  return created(c, row)
})

/**
 * GET /projects/:id — busca por ID, só se for do dono.
 */
projectsRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const row = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, user.sub)),
  })
  if (!row) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)
  return ok(c, row)
})

/**
 * PUT /projects/:id — atualiza nome/descrição/peças. Sobrescreve.
 */
projectsRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const body = await parseJsonBody(c, upsertSchema)

  const [row] = await db
    .update(projects)
    .set({
      name: body.name,
      description: body.description,
      pieces: body.pieces,
      // Só sobrescreve thumbnail se veio no payload (undefined = mantém atual).
      ...(body.thumbnail !== undefined ? { thumbnail: body.thumbnail } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.sub)))
    .returning()

  if (!row) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)
  return ok(c, row)
})

/**
 * DELETE /projects/:id
 */
projectsRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = parseParams(c, idParam)
  const result = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.sub)))
    .returning({ id: projects.id })
  if (result.length === 0) return fail(c, 'NOT_FOUND', 'Projeto não encontrado', 404)
  return noContent(c)
})
