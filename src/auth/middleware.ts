import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { verifyAccessToken, InvalidTokenError, type AccessTokenClaims } from './jwt'
import type { Permission } from '@/db/schema'

/**
 * Variáveis adicionadas ao context por este middleware. Tipagem em
 * `src/types/hono.d.ts` (declarations augmentation pra Hono).
 */
export type AuthVariables = {
  user: AccessTokenClaims
}

/**
 * Lê `Authorization: Bearer <token>` (formato padrão), valida, e
 * coloca as claims no context. Se inválido/ausente → 401.
 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const header = c.req.header('Authorization') ?? c.req.header('authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    throw new HTTPException(401, { message: 'Token ausente' })
  }
  const token = header.slice(7).trim()
  try {
    const { claims } = await verifyAccessToken(token)
    c.set('user', claims)
    await next()
  } catch (err) {
    const message = err instanceof InvalidTokenError ? err.message : 'Não autenticado'
    throw new HTTPException(401, { message })
  }
}

/**
 * Roda DEPOIS de requireAuth. Bloqueia quem não é admin com 403.
 * Usado em rotas que SÓ admin pode acessar (independente de permissions).
 */
export const requireAdmin: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const user = c.get('user')
  if (!user) {
    throw new HTTPException(401, { message: 'Não autenticado' })
  }
  if (user.role !== 'admin') {
    throw new HTTPException(403, { message: 'Acesso restrito a administradores' })
  }
  await next()
}

/**
 * Roda DEPOIS de requireAuth. Libera se o user é admin (tem tudo
 * implícito) OU se tem a permissão granular pedida. Caso contrário 403.
 */
export function requirePerm(perm: Permission): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const user = c.get('user')
    if (!user) {
      throw new HTTPException(401, { message: 'Não autenticado' })
    }
    if (user.role === 'admin' || user.permissions.includes(perm)) {
      await next()
      return
    }
    throw new HTTPException(403, { message: `Permissão necessária: ${perm}` })
  }
}
