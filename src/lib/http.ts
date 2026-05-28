import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Envelope padrão de resposta da API. Mantém um único shape pra que o
 * cliente saiba sempre o que esperar — sucesso vem em `data`, erro em
 * `error` (com `code` machine-readable + `message` humano).
 */
export type ApiOk<T> = { ok: true; data: T }
export type ApiErr = {
  ok: false
  error: { code: string; message: string; details?: unknown }
}
export type ApiResponse<T> = ApiOk<T> | ApiErr

export const ok = <T>(c: Context, data: T, status: ContentfulStatusCode = 200) =>
  c.json<ApiOk<T>>({ ok: true, data }, status)

export const created = <T>(c: Context, data: T) => ok(c, data, 201)

export const noContent = (c: Context) => c.body(null, 204)

export const fail = (
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode,
  details?: unknown,
) => c.json<ApiErr>({ ok: false, error: { code, message, details } }, status)
