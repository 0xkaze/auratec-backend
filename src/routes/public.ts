import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db/client'
import { projects } from '@/db/schema'
import { ok, fail } from '@/lib/http'

/**
 * Rotas PÚBLICAS (sem auth). Hoje só o visualizador de projeto
 * compartilhado em modo leitura.
 */
export const publicRoutes = new Hono()

/** GET /public/projects/:shareId — projeto compartilhado (read-only). */
publicRoutes.get('/projects/:shareId', async (c) => {
  const shareId = c.req.param('shareId')
  if (!shareId || shareId.length > 24) {
    return fail(c, 'BAD_REQUEST', 'shareId inválido', 400)
  }
  const row = await db.query.projects.findFirst({
    where: and(eq(projects.shareId, shareId), eq(projects.isPublic, true)),
  })
  if (!row) return fail(c, 'NOT_FOUND', 'Projeto não encontrado ou não compartilhado', 404)

  // Devolve só o necessário pra renderizar — nada sensível do dono.
  return ok(c, {
    id: row.id,
    name: row.name,
    description: row.description,
    pieces: row.pieces,
    thumbnail: row.thumbnail,
    updatedAt: row.updatedAt,
  })
})
