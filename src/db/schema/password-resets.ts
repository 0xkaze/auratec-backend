import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Tokens de reset de senha. `token_hash` = sha256 hex do token enviado
 * por email (nunca guardamos o token cru). Token expira em 30min por
 * default — gerado pela rota /auth/forgot-password.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('password_resets_user_idx').on(t.userId),
    expiresIdx: index('password_resets_expires_idx').on(t.expiresAt),
  }),
)

export type PasswordReset = typeof passwordResets.$inferSelect
