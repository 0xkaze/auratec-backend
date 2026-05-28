import { env } from '@/env'

/**
 * Checa se um email é admin segundo a env `ADMIN_EMAILS`. Case-insensitive.
 * Centralizado pra não duplicar a lógica em register/login/migrations.
 */
export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  return env.ADMIN_EMAILS.includes(normalized)
}

/** Resolve o role inicial baseado no email. */
export function resolveInitialRole(email: string): 'user' | 'admin' {
  return isAdminEmail(email) ? 'admin' : 'user'
}
