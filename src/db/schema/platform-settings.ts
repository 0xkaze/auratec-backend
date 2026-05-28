import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core'

/**
 * Settings da plataforma — key-value. Cada feature group ocupa uma row
 * com value=jsonb. Editado pelo admin em /admin/settings.
 *
 * Keys reconhecidas:
 *  - signup_policy: { enabled, requireApproval, allowedDomains[] }
 *  - user_limits:   { maxProjects, maxUploadMB }
 */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().$type<unknown>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlatformSetting = typeof platformSettings.$inferSelect

// ---- Shapes tipados por key ----
export interface SignupPolicy {
  enabled: boolean
  requireApproval: boolean
  /** Lista de domínios permitidos (ex: ['empresa.com']). Vazio = todos. */
  allowedDomains: string[]
}

export interface UserLimits {
  /** -1 = ilimitado. */
  maxProjects: number
  maxUploadMB: number
}

export const DEFAULT_SIGNUP_POLICY: SignupPolicy = {
  enabled: true,
  requireApproval: false,
  allowedDomains: [],
}

export const DEFAULT_USER_LIMITS: UserLimits = {
  maxProjects: 50,
  maxUploadMB: 60,
}
