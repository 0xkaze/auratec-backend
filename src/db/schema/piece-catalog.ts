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
 * Connector = uma regra de "o que pode encaixar neste snap point + como".
 *
 *   match.type='category': qualquer peça da categoria informada usa este
 *     mesmo offset (Torres, Bases e Cubos têm geometria padrão, basta
 *     configurar 1x por categoria).
 *   match.type='piece':    pra peças 'Outros' cada type tem geometria
 *     própria — configura individualmente (ex.: 'piece:CUMEEIRA').
 *
 * offset: ajuste fino opcional. Default identity (peça encaixa "no" snap).
 */
export interface Connector {
  match:
    | { type: 'category'; category: 'Torres' | 'Bases' | 'Cubos' }
    | { type: 'piece'; pieceType: string }
  offset: SnapPose
}

/**
 * Snap point = local da peça onde OUTRAS peças podem encaixar. Tem N
 * connectors (um por regra de match).
 *   position/rotation são em LOCAL space da peça hosting.
 *   rotation define a "direção de saída": +Y local do snap aponta pra
 *     onde a próxima peça vai sair.
 */
export interface SnapPoint {
  id: string         // único na peça: 'main', 'left', 'topo', etc.
  label: string      // display: "Ponta esquerda", "Topo"
  position: [number, number, number]
  rotation: [number, number, number]
  connectors: Connector[]
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
   * Pose de ENTRADA — como ESTA peça se posiciona quando é encaixada
   * em outra. Relativa ao snap point host. Default null = encaixa "na
   * origem" do snap (sem ajuste).
   *
   * Renomeado de snap_pose pra ficar claro que é INPUT (do ponto de
   * vista desta peça).
   */
  inputPose: jsonb('input_pose').$type<SnapPose | null>(),
  /**
   * Lista de SNAP POINTS — onde OUTRAS peças podem encaixar nesta.
   * Cada snap tem N connectors (regras de "o que e como encaixa").
   * Default [] = nenhum ponto de conexão (peça terminal).
   *
   * Substitui o output_snap único anterior — agora N snap points.
   */
  snapPoints: jsonb('snap_points').$type<SnapPoint[]>().notNull().default([]),
  /** Soft-delete pra admin "esconder" sem perder histórico. */
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CatalogPiece = typeof pieceCatalog.$inferSelect
export type NewCatalogPiece = typeof pieceCatalog.$inferInsert
