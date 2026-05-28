import { pgTable, uuid, varchar, text, jsonb, timestamp, boolean, index } from 'drizzle-orm/pg-core'
import { projects } from './projects'

/**
 * Snapshot histórico de um projeto. Gerado a cada save (manual ou auto)
 * pra permitir restaurar versões anteriores. `isAuto` distingue
 * auto-saves de saves manuais.
 */
export const projectVersions = pgTable(
  'project_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    pieces: jsonb('pieces').notNull().$type<unknown[]>().default([]),
    thumbnail: text('thumbnail'),
    label: varchar('label', { length: 120 }),
    isAuto: boolean('is_auto').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('project_versions_project_idx').on(t.projectId, t.createdAt),
  }),
)

export type ProjectVersion = typeof projectVersions.$inferSelect
