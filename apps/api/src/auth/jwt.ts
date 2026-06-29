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

export async function verifyToken(token: string): Promise<AuthClaims> {
  const payload = await verify(token, await getJwtSecret(), 'HS256');
  return { sub: String(payload.sub), email: String(payload.email) };
}
