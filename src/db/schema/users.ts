import { pgTable, uuid, varchar, text, timestamp, pgEnum } from 'drizzle-orm/pg-core'

/**
 * Papéis de usuário no sistema.
 * - user: acesso ao Construtor + seus próprios projetos. Pode receber
 *   permissões granulares via `permissions[]` pra agir no /admin.
 * - admin: tudo — implicitamente tem todas as permissões.
 */
export const userRoleEnum = pgEnum('user_role', ['user', 'admin'])

/**
 * Catálogo de permissões reconhecidas. Admin recebe TODAS implícitas.
 * Pra users normais, presença na string array libera a ação correspondente.
 */
export const PERMISSIONS = [
  'view_admin',        // acessa o painel /admin (read-only por padrão)
  'manage_users',      // CRUD em /admin/users + alterar perms/roles
  'manage_catalog',    // CRUD em /admin/catalog (peças)
  'manage_settings',   // edita /admin/settings (política de signup, limites)
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  /** Hash Argon2id. Nunca exposto em response. */
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('user'),
  /** Lista de permissions granulares. Ignorado quando role='admin' (admin = tudo). */
  permissions: text('permissions').array().notNull().$type<Permission[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
/** Versão "pública" do user — sem o hash. Usado em responses. */
export type PublicUser = Omit<User, 'passwordHash'>

export function toPublicUser(u: User): PublicUser {
  const { passwordHash: _omit, ...rest } = u
  return rest
}

/** Admin tem tudo implícito; user normal tem apenas o que está em permissions. */
export function userHasPermission(u: Pick<User, 'role' | 'permissions'>, perm: Permission): boolean {
  if (u.role === 'admin') return true
  return u.permissions.includes(perm)
}
