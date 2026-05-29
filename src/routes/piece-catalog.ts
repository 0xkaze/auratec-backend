import { Hono } from 'hono'
import { z } from 'zod'
import { eq, asc } from 'drizzle-orm'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/db/client'
import { pieceCatalog, type AttachTarget } from '@/db/schema'
import { requirePerm, requireAuth, type AuthVariables } from '@/auth/middleware'
import { parseJsonBody, parseParams } from '@/lib/validate'
import { ok, created, fail, noContent } from '@/lib/http'
import { getUserLimits } from '@/services/platform-settings'
import { logActivity } from '@/services/activity-log'

const vec3 = z.tuple([z.number(), z.number(), z.number()])
const snapPoseSchema = z.object({ position: vec3, rotation: vec3 })

const hostSlotSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  pose: snapPoseSchema,
  direction: z.enum(['top', 'bottom']),
  targets: z.array(z.enum(['Torres', 'Bases', 'Cubos', 'Outros', 'self'])),
})

const upsertSchema = z.object({
  type: z.string().regex(/^[A-Z0-9_]+$/, 'type deve ser SCREAMING_SNAKE_CASE').max(64),
  name: z.string().min(1).max(120),
  category: z.enum(['Torres', 'Bases', 'Cubos', 'Outros']),
  widthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  depthMm: z.number().int().positive().nullable().optional(),
  weightKg: z.number().nonnegative(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0e0a66'),
  glbPath: z.string().min(1),
  sku: z.string().trim().max(64).nullable().optional(),
  productUrl: z.string().url().max(2048).nullable().optional(),
  spawnYOffset: z.number().default(0),
  spawnPose: snapPoseSchema.nullable().optional(),
  attachableTo: z
    .array(
      z.union([
        z.enum(['Torres', 'Bases', 'Cubos', 'Outros']),
        z.string().regex(/^piece:[A-Z0-9_]+$/),
      ]),
    )
    .optional(),
  dockAbove: snapPoseSchema.nullable().optional(),
  dockBelow: snapPoseSchema.nullable().optional(),
  hostSlots: z.array(hostSlotSchema).optional(),
  isActive: z.boolean().default(true),
})

const partialUpdateSchema = upsertSchema.partial()
const idParam = z.object({ id: z.string().uuid() })

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'objetos')
/** Limite absoluto (sanity check) — settings.user_limits.maxUploadMB
 *  pode estreitar isso pra menos, mas nunca além desta cota. */
const ABSOLUTE_MAX_UPLOAD_BYTES = 200 * 1024 * 1024

export const pieceCatalogRoutes = new Hono<{ Variables: AuthVariables }>()

/**
 * GET /piece-catalog — listagem PÚBLICA (sem auth). Retorna só peças
 * ativas. Inclui snap_pose / output_snap pra que o front possa aplicar
 * diretamente. Catálogo não é dado sensível — landing page consome também.
 */
pieceCatalogRoutes.get('/', async (c) => {
  const rows = await db
    .select()
    .from(pieceCatalog)
    .where(eq(pieceCatalog.isActive, true))
    .orderBy(asc(pieceCatalog.category), asc(pieceCatalog.heightMm))
  return ok(c, rows)
})

/** GET /piece-catalog/all — admin vê inclusive inativas. */
pieceCatalogRoutes.get('/all', requireAuth, requirePerm('manage_catalog'), async (c) => {
  const rows = await db
    .select()
    .from(pieceCatalog)
    .orderBy(asc(pieceCatalog.category), asc(pieceCatalog.heightMm))
  return ok(c, rows)
})

/** GET /piece-catalog/:id — admin lê uma peça específica (pra edição). */
pieceCatalogRoutes.get('/:id', requireAuth, requirePerm('manage_catalog'), async (c) => {
  const { id } = parseParams(c, idParam)
  const row = await db.query.pieceCatalog.findFirst({ where: eq(pieceCatalog.id, id) })
  if (!row) return fail(c, 'NOT_FOUND', 'Peça não encontrada', 404)
  return ok(c, row)
})

/**
 * POST /piece-catalog — cria peça (admin only). Aceita snap_pose /
 * output_snap se já vier preenchido (mas o normal é null e configurar
 * depois via PATCH no Configurador).
 */
pieceCatalogRoutes.post('/', requireAuth, requirePerm('manage_catalog'), async (c) => {
  const body = await parseJsonBody(c, upsertSchema)
  const [row] = await db
    .insert(pieceCatalog)
    .values({ ...body, attachableTo: body.attachableTo as AttachTarget[] | undefined })
    .returning()
  if (!row) return fail(c, 'INSERT_FAILED', 'Falha ao criar peça', 500)
  logActivity({
    userId: c.get('user').sub,
    action: 'piece.create',
    entityType: 'piece',
    entityId: row.id,
    metadata: { name: row.name, type: row.type },
  })
  return created(c, row)
})

/**
 * PATCH /piece-catalog/:id — atualização parcial (admin only). Mesmo
 * endpoint usado pelo Configurador pra salvar snap_pose / output_snap.
 */
pieceCatalogRoutes.patch('/:id', requireAuth, requirePerm('manage_catalog'), async (c) => {
  const { id } = parseParams(c, idParam)
  const body = await parseJsonBody(c, partialUpdateSchema)
  const [row] = await db
    .update(pieceCatalog)
    .set({ ...body, attachableTo: body.attachableTo as AttachTarget[] | undefined, updatedAt: new Date() })
    .where(eq(pieceCatalog.id, id))
    .returning()
  if (!row) return fail(c, 'NOT_FOUND', 'Peça não encontrada', 404)
  logActivity({
    userId: c.get('user').sub,
    action: 'piece.update',
    entityType: 'piece',
    entityId: row.id,
    metadata: { name: row.name, type: row.type },
  })
  return ok(c, row)
})

/**
 * DELETE /piece-catalog/:id — hard delete (admin). Também remove o GLB
 * do disco se estiver em uploads/objetos. Pra "esconder" sem perder
 * dados, prefira PATCH com isActive=false.
 */
pieceCatalogRoutes.delete('/:id', requireAuth, requirePerm('manage_catalog'), async (c) => {
  const { id } = parseParams(c, idParam)
  const row = await db.query.pieceCatalog.findFirst({ where: eq(pieceCatalog.id, id) })
  if (!row) return fail(c, 'NOT_FOUND', 'Peça não encontrada', 404)

  await db.delete(pieceCatalog).where(eq(pieceCatalog.id, id))
  logActivity({
    userId: c.get('user').sub,
    action: 'piece.delete',
    entityType: 'piece',
    entityId: id,
    metadata: { name: row.name, type: row.type },
  })

  // Remove o GLB se foi um upload (caminho /objetos/<filename>).
  // Não toca em GLBs externos (URLs http://...).
  if (row.glbPath.startsWith('/objetos/')) {
    const filename = row.glbPath.slice('/objetos/'.length)
    const filepath = join(UPLOADS_DIR, filename)
    if (existsSync(filepath)) {
      try {
        await unlink(filepath)
      } catch (err) {
        console.warn('[piece-catalog] falha ao remover GLB do disco:', err)
      }
    }
  }

  return noContent(c)
})

/**
 * POST /piece-catalog/upload — recebe um GLB via multipart/form-data
 * (campo "file") e devolve o `glbPath` pra ser usado no create/update.
 *
 * Validação: aceita .glb apenas. Sanitiza filename (slug + timestamp
 * pra evitar colisão e path traversal).
 */
pieceCatalogRoutes.post('/upload', requireAuth, requirePerm('manage_catalog'), async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return fail(c, 'BAD_REQUEST', 'multipart/form-data esperado', 400)

  const file = form.get('file')
  if (!(file instanceof File)) {
    return fail(c, 'BAD_REQUEST', 'Campo "file" ausente ou inválido', 400)
  }
  if (file.size === 0) {
    return fail(c, 'EMPTY_FILE', 'Arquivo vazio', 400)
  }
  const limits = await getUserLimits()
  const maxBytes = Math.min(limits.maxUploadMB * 1024 * 1024, ABSOLUTE_MAX_UPLOAD_BYTES)
  if (file.size > maxBytes) {
    return fail(
      c,
      'FILE_TOO_LARGE',
      `Arquivo > ${(maxBytes / 1024 / 1024).toFixed(0)}MB. Comprima com gltfpack antes.`,
      413,
    )
  }
  if (!file.name.toLowerCase().endsWith('.glb')) {
    return fail(c, 'INVALID_TYPE', 'Aceito apenas .glb', 400)
  }

  // Sanitiza nome: remove path separators + acentos, prefix com timestamp
  // pra evitar colisão.
  const safeOriginal = file.name
    .replace(/[/\\]/g, '_')
    .replace(/[^\w.\-,()]/g, '_')
  const filename = `${Date.now()}_${safeOriginal}`
  const filepath = join(UPLOADS_DIR, filename)

  await mkdir(UPLOADS_DIR, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filepath, buffer)

  return created(c, {
    glbPath: `/objetos/${filename}`,
    sizeBytes: file.size,
  })
})
