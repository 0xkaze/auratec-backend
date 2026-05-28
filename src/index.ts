import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { env } from '@/env'
import { authRoutes } from '@/routes/auth'
import { projectsRoutes } from '@/routes/projects'
import { pieceCatalogRoutes } from '@/routes/piece-catalog'
import { adminRoutes } from '@/routes/admin'
import { publicRoutes } from '@/routes/public'
import { fail } from '@/lib/http'

const app = new Hono()

// ---- Middlewares globais ----
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGINS,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 600,
  }),
)

// ---- Health check (Docker/CI) ----
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ---- Static GLBs (peças 3D) ----
// Serve arquivos de `uploads/objetos/` em `/objetos/*` com CORS aberto
// e cache agressivo (GLBs são imutáveis — nome inclui timestamp). O
// front carrega `${API_URL}/objetos/<filename>` direto.
const UPLOADS_ROOT = join(process.cwd(), 'uploads', 'objetos')
app.get('/objetos/*', async (c) => {
  // Extrai filename da URL (depois de /objetos/) e bloqueia path traversal.
  const requested = c.req.path.slice('/objetos/'.length)
  const filename = normalize(requested).replace(/^(\.\.[/\\])+/, '')
  if (filename.includes('..') || filename.includes('/')) {
    return c.text('Forbidden', 403)
  }
  const filepath = join(UPLOADS_ROOT, filename)
  if (!existsSync(filepath)) {
    return c.text('Not found', 404)
  }
  const file = Bun.file(filepath)
  return new Response(file, {
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  })
})

// ---- API rotas ----
const api = new Hono()
api.route('/auth', authRoutes)
api.route('/projects', projectsRoutes)
api.route('/piece-catalog', pieceCatalogRoutes)
api.route('/admin', adminRoutes)
api.route('/public', publicRoutes)
app.route('/api', api)

// ---- Error handler global ----
// Mantém o envelope `{ ok: false, error: {code, message} }` consistente
// pra qualquer falha, vindo de HTTPException, validação Zod, ou bug.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const cause = (err as any).cause
    const code = err.status === 401 ? 'UNAUTHORIZED'
      : err.status === 403 ? 'FORBIDDEN'
      : err.status === 404 ? 'NOT_FOUND'
      : err.status === 400 ? 'BAD_REQUEST'
      : 'HTTP_ERROR'
    return fail(c, code, err.message, err.status as 400 | 401 | 403 | 404, cause)
  }
  console.error('[unhandled]', err)
  return fail(c, 'INTERNAL_ERROR', 'Erro interno', 500)
})

app.notFound((c) => fail(c, 'NOT_FOUND', 'Rota não encontrada', 404))

// ---- Bootstrap ----
const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
})

console.log(`\n🚀 Auratec API rodando em http://localhost:${server.port}`)
console.log(`   Ambiente: ${env.NODE_ENV}`)
console.log(`   CORS: ${env.CORS_ORIGINS.join(', ')}\n`)
