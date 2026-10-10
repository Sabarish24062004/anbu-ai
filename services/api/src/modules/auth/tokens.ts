import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'anbu-api';
const AUDIENCE = 'anbu-app';

export interface TokenConfig {
  accessSecret: Uint8Array;
  accessTtlMinutes: number;
  refreshTtlDays: number;
}

export async function createAccessToken(userId: string, config: TokenConfig) {
  const expiresAt = new Date(Date.now() + config.accessTtlMinutes * 60_000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(config.accessSecret);
  return { token, expiresAt };
}

/** Returns the user id, or null for any invalid, expired or tampered token. */
export async function verifyAccessToken(
  token: string,
  config: TokenConfig,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, config.accessSecret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** Refresh tokens are opaque random strings; only their SHA-256 is stored. */
export function generateRefreshToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
