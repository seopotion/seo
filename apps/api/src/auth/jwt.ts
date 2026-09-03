import { sign, verify } from 'hono/jwt';
import { config } from '../config';
import { getJwtSecret } from './secret';

export interface AuthClaims {
  /** User id (Mongo id string). */
  sub: string;
  email: string;
}

export async function signToken(claims: AuthClaims): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + config.JWT_TTL_SECONDS;
  return sign({ ...claims, exp }, await getJwtSecret());
}

/**
 * Verifies a session token. Purpose-scoped tokens (the GSC OAuth `state`,
 * lib/gsc-state.ts) are signed with the same secret and handed to the browser,
 * so a `purpose` claim — or a missing `sub` — is rejected here (#101).
 */
export async function verifyToken(token: string): Promise<AuthClaims> {
  const payload = await verify(token, await getJwtSecret(), 'HS256');
  if (payload.purpose !== undefined || typeof payload.sub !== 'string') {
    throw new Error('Not a session token');
  }
  return { sub: payload.sub, email: String(payload.email) };
}
