import { db } from '@/db/client'
import { activityLogs } from '@/db/schema'

interface LogInput {
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  projectId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Registra uma atividade. Best-effort: nunca lança — se o log falhar,
 * a operação principal não deve quebrar. Fire-and-forget (não await
 * obrigatório no caller).
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      projectId: input.projectId ?? null,
      metadata: input.metadata ?? {},
    })
  } catch (err) {
    console.warn('[activity-log] falha ao registrar:', err)
  }
}
