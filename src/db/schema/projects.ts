import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Projetos salvos pelo usuário. A composição (peças) é armazenada como
 * JSONB porque a estrutura espelha exatamente o `TorrePiece[]` do front
 * (id, type, position, rotation, isLaidDown) — não vale a pena normalizar
 * isso em uma tabela "pieces" relacional. Buscas filtram por owner +
 * intervalo de updated_at; nada precisa indexar dentro do JSON.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description').default(''),
    /** Array de TorrePiece serializado. Forma é responsabilidade do front. */
    pieces: jsonb('pieces').notNull().$type<unknown[]>().default([]),
    /** Snapshot 3D (dataURL JPEG pequeno) capturado no save. NULL = sem preview. */
    thumbnail: text('thumbnail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('projects_owner_idx').on(t.ownerId, t.updatedAt),
  }),
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
