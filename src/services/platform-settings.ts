import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  platformSettings,
  DEFAULT_SIGNUP_POLICY,
  DEFAULT_USER_LIMITS,
  type SignupPolicy,
  type UserLimits,
} from '@/db/schema'

const SIGNUP_KEY = 'signup_policy'
const LIMITS_KEY = 'user_limits'

/** Lê do DB ou devolve default se a row não existir. */
async function getRaw<T>(key: string, fallback: T): Promise<T> {
  const row = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, key) })
  if (!row) return fallback
  return row.value as T
}

export async function getSignupPolicy(): Promise<SignupPolicy> {
  return getRaw<SignupPolicy>(SIGNUP_KEY, DEFAULT_SIGNUP_POLICY)
}

export async function getUserLimits(): Promise<UserLimits> {
  return getRaw<UserLimits>(LIMITS_KEY, DEFAULT_USER_LIMITS)
}

async function upsert(key: string, value: unknown): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: new Date() },
    })
}

export async function setSignupPolicy(value: SignupPolicy): Promise<void> {
  await upsert(SIGNUP_KEY, value)
}

export async function setUserLimits(value: UserLimits): Promise<void> {
  await upsert(LIMITS_KEY, value)
}

/**
 * Valida se um email pode se registrar dadas as políticas atuais.
 * Devolve null = ok, ou string = razão da rejeição.
 */
export async function checkSignupAllowed(email: string): Promise<string | null> {
  const policy = await getSignupPolicy()
  if (!policy.enabled) return 'Cadastro de novos usuários está desabilitado'
  if (policy.allowedDomains.length > 0) {
    const domain = email.split('@')[1]?.toLowerCase() ?? ''
    if (!policy.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
      return `Domínio ${domain} não está autorizado`
    }
  }
  return null
}
