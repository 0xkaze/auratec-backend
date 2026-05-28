/**
 * Seed inicial: cria admin padrão (se não existir) + popula o catálogo
 * de peças com os dados que hoje estão hardcoded em `auratec-frontend/
 * src/lib/torres.ts`. Idempotente — pode rodar várias vezes sem
 * duplicar.
 *
 * Uso: `bun run db:seed`
 */
import { eq } from 'drizzle-orm'
import { db } from './client'
import { users, pieceCatalog, type NewCatalogPiece } from './schema'
import { hashPassword } from '@/auth/password'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@auratec.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123'

const CATALOG: NewCatalogPiece[] = [
  // ---- Torres ----
  { type: 'TORRE_0_2M',   name: 'Torre 0,2M',  category: 'Torres', widthMm: 300, heightMm: 200,  weightKg: 2.0,  glbPath: '/objetos/TORRE_AL-P30_0,2M.glb' },
  { type: 'TORRE_0_25M',  name: 'Torre 0,25M', category: 'Torres', widthMm: 300, heightMm: 250,  weightKg: 2.1,  glbPath: '/objetos/TORRE_AL-P30_0,25M.glb' },
  { type: 'TORRE_0_3M',   name: 'Torre 0,3M',  category: 'Torres', widthMm: 300, heightMm: 300,  weightKg: 2.8,  glbPath: '/objetos/TORRE_AL-P30_0,3M.glb' },
  { type: 'TORRE_0_35M',  name: 'Torre 0,35M', category: 'Torres', widthMm: 300, heightMm: 350,  weightKg: 2.9,  glbPath: '/objetos/TORRE_AL-P30_0,35M.glb' },
  { type: 'TORRE_0_4M',   name: 'Torre 0,4M',  category: 'Torres', widthMm: 300, heightMm: 400,  weightKg: 3.3,  glbPath: '/objetos/TORRE_AL-P30_0,4M.glb' },
  { type: 'TORRE_0_5M',   name: 'Torre 0,5M',  category: 'Torres', widthMm: 300, heightMm: 500,  weightKg: 4.2,  glbPath: '/objetos/TORRE_AL-P30_0,5M.glb' },
  { type: 'TORRE_0_6M',   name: 'Torre 0,6M',  category: 'Torres', widthMm: 300, heightMm: 600,  weightKg: 5.0,  glbPath: '/objetos/TORRE_AL-P30_0,6M.glb' },
  { type: 'TORRE_0_67M',  name: 'Torre 0,67M', category: 'Torres', widthMm: 300, heightMm: 670,  weightKg: 5.5,  glbPath: '/objetos/TORRE_AL-P30_0,67M.glb' },
  { type: 'TORRE_0_7M',   name: 'Torre 0,7M',  category: 'Torres', widthMm: 300, heightMm: 700,  weightKg: 5.8,  glbPath: '/objetos/TORRE_AL-P30_0,7M.glb' },
  { type: 'TORRE_0_8M',   name: 'Torre 0,8M',  category: 'Torres', widthMm: 300, heightMm: 800,  weightKg: 6.6,  glbPath: '/objetos/TORRE_AL-P30_0,8M.glb' },
  { type: 'TORRE_0_9M',   name: 'Torre 0,9M',  category: 'Torres', widthMm: 300, heightMm: 900,  weightKg: 7.5,  glbPath: '/objetos/TORRE_AL-P30_0,9M.glb' },
  { type: 'TORRE_1M',     name: 'Torre 1M',    category: 'Torres', widthMm: 300, heightMm: 1000, weightKg: 8.3,  glbPath: '/objetos/TORRE.glb' },
  { type: 'TORRE_1_5M',   name: 'Torre 1,5M',  category: 'Torres', widthMm: 300, heightMm: 1500, weightKg: 12.5, glbPath: '/objetos/TORRE_AL-P30_1,5M.glb' },
  { type: 'TORRE_2M',     name: 'Torre 2M',    category: 'Torres', widthMm: 300, heightMm: 2000, weightKg: 16.5, glbPath: '/objetos/TORRE_AL-P30_2M.glb' },
  { type: 'TORRE_2_5M',   name: 'Torre 2,5M',  category: 'Torres', widthMm: 300, heightMm: 2500, weightKg: 20.8, glbPath: '/objetos/TORRE_AL-P30_2,5M.glb' },
  { type: 'TORRE_3M',     name: 'Torre 3M',    category: 'Torres', widthMm: 300, heightMm: 3000, weightKg: 24.9, glbPath: '/objetos/TORRE_AL-P30_3M.glb' },
  { type: 'TORRE_3_5M',   name: 'Torre 3,5M',  category: 'Torres', widthMm: 300, heightMm: 3500, weightKg: 29.1, glbPath: '/objetos/TORRE_AL-P30_3,5M.glb' },
  { type: 'TORRE_4M',     name: 'Torre 4M',    category: 'Torres', widthMm: 300, heightMm: 4000, weightKg: 33.2, glbPath: '/objetos/TORRE_AL-P30_4M.glb' },
  { type: 'TORRE_4_5M',   name: 'Torre 4,5M',  category: 'Torres', widthMm: 300, heightMm: 4500, weightKg: 37.5, glbPath: '/objetos/TORRE_AL-P30_4,5M.glb' },
  { type: 'TORRE_5M',     name: 'Torre 5M',    category: 'Torres', widthMm: 300, heightMm: 5000, weightKg: 41.5, glbPath: '/objetos/TORRE_AL-P30_5M.glb' },
  { type: 'TORRE_6M',     name: 'Torre 6M',    category: 'Torres', widthMm: 300, heightMm: 6000, weightKg: 50.0, glbPath: '/objetos/TORRE_AL-P30_6M.glb' },

  // ---- Bases ----
  { type: 'BASE_QUADRADA', name: 'Base Quadrada 800x800mm', category: 'Bases', widthMm: 800, heightMm: 150, depthMm: 800, weightKg: 15.0, glbPath: '/objetos/BASE_QUADRADA_AL-P30_-_800x800MM.glb', spawnYOffset: 0.08 },
  { type: 'BASE_800X300MM', name: 'Base 800x300mm', category: 'Bases', widthMm: 800, heightMm: 150, depthMm: 300, weightKg: 12.0, glbPath: '/objetos/Base_800x300mm.glb', spawnYOffset: 0.15 },
  { type: 'BASE_1200X800MM', name: 'Base 1200x800mm', category: 'Bases', widthMm: 1200, heightMm: 150, depthMm: 800, weightKg: 22.0, glbPath: '/objetos/Base_1200x800mm.glb', spawnYOffset: 0.15 },
  { type: 'BASE_QUADRADA_TUBO_RETANGULAR_800X800MM', name: 'Base Quadrada (Tubo Retangular) 800x800mm', category: 'Bases', widthMm: 800, heightMm: 150, depthMm: 800, weightKg: 18.0, glbPath: '/objetos/BASE_QUADRADA_(TUBO_RETANGULAR)_800X800MM_-_AL-P30.glb' },

  // ---- Cubos (snap automático por face — lógica própria no frontend) ----
  { type: 'CUBO_5F', name: 'Cubo 5 Faces (2C 3F)', category: 'Cubos', widthMm: 300, heightMm: 300, depthMm: 300, weightKg: 10.0, glbPath: '/objetos/CUBO_5F_(2C_3F).glb' },
  { type: 'SLEEVE_AL_P30_P50', name: 'Sleeve AL-P30-P50', category: 'Cubos', widthMm: 300, heightMm: 300, depthMm: 300, weightKg: 8.0, glbPath: '/objetos/Sleeve_AL-P30-P50.glb' },

  // ---- Outros (admin configura snap manualmente no Configurador) ----
  { type: 'BLOCO_ADAPTADOR', name: 'Bloco Adaptador', category: 'Outros', widthMm: 300, heightMm: 300, depthMm: 300, weightKg: 8.0, glbPath: '/objetos/Bloco_Adaptador_AL-P30.glb' },
  { type: 'CUMEEIRA', name: 'Cumeeira', category: 'Outros', widthMm: 300, heightMm: 400, depthMm: 300, weightKg: 12.0, glbPath: '/objetos/CUMEEIRA_AL-P30.glb' },
  { type: 'PAU_DE_CARGA', name: 'Pau de Carga', category: 'Outros', widthMm: 300, heightMm: 300, depthMm: 300, weightKg: 9.0, glbPath: '/objetos/PAU_DE_CARGA_AL-P30.glb' },
]

async function ensureAdmin() {
  const existing = await db.query.users.findFirst({ where: eq(users.email, ADMIN_EMAIL) })
  if (existing) {
    console.log(`  ✓ Admin já existe: ${ADMIN_EMAIL}`)
    return
  }
  const passwordHash = await hashPassword(ADMIN_PASSWORD)
  await db.insert(users).values({
    email: ADMIN_EMAIL,
    name: 'Admin',
    passwordHash,
    role: 'admin',
  })
  console.log(`  ✓ Admin criado: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  console.log(`    ⚠ Troque a senha em produção!`)
}

async function ensureCatalog() {
  let inserted = 0
  let updated = 0
  for (const piece of CATALOG) {
    const existing = await db.query.pieceCatalog.findFirst({ where: eq(pieceCatalog.type, piece.type) })
    if (existing) {
      await db.update(pieceCatalog).set({ ...piece, updatedAt: new Date() }).where(eq(pieceCatalog.id, existing.id))
      updated++
    } else {
      await db.insert(pieceCatalog).values(piece)
      inserted++
    }
  }
  console.log(`  ✓ Catálogo: ${inserted} inseridas, ${updated} atualizadas`)
}

async function main() {
  console.log('🌱 Seed do banco…')
  await ensureAdmin()
  await ensureCatalog()
  console.log('✅ Seed concluído.')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Seed falhou:', err)
  process.exit(1)
})
