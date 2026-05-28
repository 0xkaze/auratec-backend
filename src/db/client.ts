import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from './schema'

/**
 * Pool de conexão Postgres + cliente Drizzle.
 *
 * `max: 10` é conservador pra dev; em prod ajustar baseado em carga e
 * limite do banco. `prepare: false` desabilita statement prepared
 * caching no driver — necessário pra que pgbouncer (se for usar) em
 * modo transaction não dê pau. Pra setup direto-no-postgres, pode
 * deixar true pra performance levemente melhor.
 */
const client = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === 'production' ? 20 : 10,
  prepare: false,
})

export const db = drizzle(client, { schema, logger: env.NODE_ENV === 'development' })
export type DB = typeof db
