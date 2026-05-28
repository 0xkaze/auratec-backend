import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import { env } from '@/env'
import type { Permission } from '@/db/schema'

const ISSUER = 'auratec'
const AUDIENCE = 'auratec-web'

const secret = new TextEncoder().encode(env.JWT_SECRET)

export interface AccessTokenClaims {
  sub: string // user id
  role: 'user' | 'admin'
  email: string
  name: string
  /** Permissions granulares. Admin tem implicitamente tudo. */
  permissions: Permission[]
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(secret)
}

export interface VerifiedToken {
  claims: AccessTokenClaims
}

/**
 * Valida o token. Lança InvalidTokenError em qualquer falha (expirado,
 * assinatura ruim, claims faltando) — handler de erro retorna 401.
 */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTokenError'
  }
}

export async function verifyAccessToken(token: string): Promise<VerifiedToken> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    })
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new InvalidTokenError('Token sem sub')
    }
    const role = payload.role
    if (role !== 'user' && role !== 'admin') {
      throw new InvalidTokenError('Token com role inválido')
    }
    const email = payload.email
    const name = payload.name
    if (typeof email !== 'string' || typeof name !== 'string') {
      throw new InvalidTokenError('Token sem email/name')
    }
    // Tokens antigos (pré-permissions) não tinham este campo — trata como [].
    const rawPerms = payload.permissions
    const permissions: Permission[] = Array.isArray(rawPerms)
      ? (rawPerms.filter((p) => typeof p === 'string') as Permission[])
      : []
    return { claims: { sub: payload.sub, role, email, name, permissions } }
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err
    if (err instanceof joseErrors.JWTExpired) throw new InvalidTokenError('Token expirado')
    if (err instanceof joseErrors.JWTClaimValidationFailed)
      throw new InvalidTokenError('Token com claims inválidas')
    if (err instanceof joseErrors.JWSSignatureVerificationFailed)
      throw new InvalidTokenError('Assinatura inválida')
    throw new InvalidTokenError('Token inválido')
  }
}
