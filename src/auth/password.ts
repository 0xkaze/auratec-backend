import { hash, verify } from '@node-rs/argon2'

/**
 * Parâmetros do Argon2id seguindo as recomendações da OWASP (2024):
 *   - algorithm: 2 = Argon2id (não usamos enum por isolatedModules)
 *   - memoryCost: 19456 KiB (~19 MB) — segurança/perf balanceada
 *   - timeCost: 2 iterações
 *   - parallelism: 1 lane (single-thread por hash)
 *
 * Trocar pra valores mais altos só se o servidor tiver CPU/mem sobrando
 * E os ataques de offline cracking forem uma preocupação real.
 */
const ARGON2_PARAMS = {
  algorithm: 2, // Algorithm.Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_PARAMS)
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try {
    return await verify(hashed, plain)
  } catch {
    // Hash malformado ou erro do binding → tratar como senha errada.
    return false
  }
}
