import { pgTable, uuid, varchar, integer, real, text, timestamp, pgEnum, boolean, jsonb } from 'drizzle-orm/pg-core'

/**
 * Catálogo de peças disponíveis no Construtor. Substitui o `torres.ts`
 * hardcoded — assim o admin pode adicionar/remover peças sem rebuild.
 *
 * Categorias (todas com lógica própria de snap, exceto Outros):
 *   - Torres: peças verticais simples, snap automático nas extremidades
 *   - Bases: bases planas (800x800, 1200x800, tubo retangular, etc.) —
 *     snap automático (BASE_SNAP_CONFIG no frontend)
 *   - Cubos: cubos com snap nas faces (CUBO_5F, Sleeve) — snap automático
 *   - Outros: geometrias complexas (cumeeira, bloco adaptador, etc.) —
 *     o admin configura `snapPose` e `outputSnap` manualmente
 *
 * Dimensões em MILÍMETROS. O front escala pra metros (÷ 1000) e aplica
 * 2x na renderização.
 */
export const pieceCategoryEnum = pgEnum('piece_category', ['Torres', 'Bases', 'Cubos', 'Outros'])

/** Pose 3D serializada em jsonb (posição + rotação Euler XYZ). */
export interface SnapPose {
  position: [number, number, number]
  rotation: [number, number, number]
}

/**
 * Alvo em que uma peça pode encaixar (Step 2 do wizard, lado "entrada").
 * Token: categoria inteira OU peça específica (pra Outros).
 *   'Torres' | 'Bases' | 'Cubos' | 'Outros' | 'piece:<TYPE>'
 */
export type AttachTarget =
  | 'Torres'
  | 'Bases'
  | 'Cubos'
  | 'Outros'
  | `piece:${string}`

/**
 * Alvo de um HostSlot (Step 3): cada categoria + 'self' (a própria peça).
 */
export type HostSlotTarget = 'Torres' | 'Bases' | 'Cubos' | 'Outros' | 'self'

/**
 * HostSlot = como UM tipo de alvo encaixa NESTA peça (Step 3).
 *   target:    qual alvo (categoria ou 'self').
 *   enabled:   se este encaixe está habilitado.
 *   direction: 'top' = guest entra usando a âncora dock_above (fica em cima);
 *              'bottom' = usa dock_below (fica embaixo).
 *   pose:      local (frame da peça) onde o guest encaixa.
 */
export interface HostSlot {
  target: HostSlotTarget
  enabled: boolean
  direction: 'top' | 'bottom'
  pose: SnapPose
}

export const pieceCatalog = pgTable('piece_catalog', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Slug estável usado pelo código do front (ex: 'TORRE_0_5M'). */
  type: varchar('type', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  category: pieceCategoryEnum('category').notNull(),
  widthMm: integer('width_mm').notNull(),
  heightMm: integer('height_mm').notNull(),
  /** Pra peças não-cilíndricas. NULL = igual width. */
  depthMm: integer('depth_mm'),
  weightKg: real('weight_kg').notNull(),
  color: varchar('color', { length: 16 }).notNull().default('#0e0a66'),
  /** Caminho relativo do GLB. Resolvido pelo front contra o backend
   *  (ex: `/objetos/CUMEEIRA.glb` → `${API_URL}/objetos/CUMEEIRA.glb`). */
  glbPath: text('glb_path').notNull(),
  /** SKU do produto no site de vendas (link comercial). Opcional. */
  sku: varchar('sku', { length: 64 }),
  /** URL completa do produto no site (opcional). */
  productUrl: text('product_url'),
  /** Offset Y de spawn (m). Usado pra pôr bases ligeiramente acima do chão. */
  spawnYOffset: real('spawn_y_offset').notNull().default(0),
  /**
   * STEP 1 — Pose de repouso da peça quando colocada sozinha (spawn).
   * Define a orientação inicial / referencial de rotação. null = identidade.
   */
  spawnPose: jsonb('spawn_pose').$type<SnapPose | null>(),
  /**
   * STEP 2 (lado entrada) — em quais alvos ESTA peça pode encaixar.
   * Lista de tokens (categoria ou piece:<TYPE>). [] = não encaixa em nada.
   */
  attachableTo: jsonb('attachable_to').$type<AttachTarget[]>().notNull().default([]),
  /**
   * STEP 2 — âncora quando ESTA peça entra EM CIMA de um host (snap top).
   * null = identidade (encaixa na origem, orientação da spawnPose).
   */
  dockAbove: jsonb('dock_above').$type<SnapPose | null>(),
  /**
   * STEP 2 — âncora quando ESTA peça entra EMBAIXO de um host (snap bottom).
   * null = identidade.
   */
  dockBelow: jsonb('dock_below').$type<SnapPose | null>(),
  /**
   * STEP 3 — slots fixos por alvo (Torres/Bases/Cubos/Outros/self):
   * como cada tipo de peça encaixa NESTA. Default [] = nada encaixa.
   */
  hostSlots: jsonb('host_slots').$type<HostSlot[]>().notNull().default([]),
  /** Soft-delete pra admin "esconder" sem perder histórico. */
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CatalogPiece = typeof pieceCatalog.$inferSelect
export type NewCatalogPiece = typeof pieceCatalog.$inferInsert
