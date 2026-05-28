import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { projects } from './projects'

/**
 * Log de atividades. Registra ações relevantes (CRUD de projetos/peças,
 * mudanças de usuário) pra rastreabilidade no painel admin.
 *
 * userId pode ser NULL (SET NULL no delete do usuário) pra preservar o
 * histórico mesmo após a conta sumir.
 */
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Ex: 'project.create', 'project.update', 'piece.delete', 'user.update'. */
    action: varchar('action', { length: 64 }).notNull(),
    /** Ex: 'project', 'piece', 'user', 'settings'. */
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: uuid('entity_id'),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index('activity_logs_created_idx').on(t.createdAt),
    userIdx: index('activity_logs_user_idx').on(t.userId),
    projectIdx: index('activity_logs_project_idx').on(t.projectId),
  }),
)

export type ActivityLog = typeof activityLogs.$inferSelect
