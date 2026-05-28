import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ZodSchema, z } from 'zod'

/**
 * Helpers de validação que parseiam body/query/params e devolvem dados
 * tipados. Em caso de falha, lançam HTTPException(400) com as issues
 * do Zod — capturadas pelo handler global em src/index.ts.
 */

export async function parseJsonBody<T>(c: Context, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HTTPException(400, { message: 'Body precisa ser JSON válido' })
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new HTTPException(400, {
      message: 'Validação falhou',
      cause: result.error.flatten(),
    })
  }
  return result.data
}

export function parseQuery<T>(c: Context, schema: ZodSchema<T>): T {
  const raw = c.req.query()
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new HTTPException(400, {
      message: 'Query inválida',
      cause: result.error.flatten(),
    })
  }
  return result.data
}

export function parseParams<T>(c: Context, schema: ZodSchema<T>): T {
  const raw = c.req.param()
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new HTTPException(400, {
      message: 'Parâmetros inválidos',
      cause: result.error.flatten(),
    })
  }
  return result.data
}

/** Helper pra inferir tipo de schema sem repetir z.infer */
export type Infer<S extends ZodSchema> = z.infer<S>
