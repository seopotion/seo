import { sign, verify } from 'hono/jwt';
import { config } from '../config';
import { getAdminJwtSecret } from './secret';

/** Single role in v0; the claim exists so tiers are additive later. */
export type AdminRole = 'operator';

export interface AdminClaims {
  /** Operator email (doubles as the subject — operators are not `users` rows). */
  sub: string;
  email: string;
  role: AdminRole;
}

export async function signAdminToken(email: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + config.ADMIN_JWT_TTL_SECONDS;
  return sign({ sub: email, email, role: 'operator', exp }, await getAdminJwtSecret());
}

export async function verifyAdminToken(token: string): Promise<AdminClaims> {
  // This hono/jwt version requires the explicit algorithm argument.
  const payload = await verify(token, await getAdminJwtSecret(), 'HS256');
  return { sub: String(payload.sub), email: String(payload.email), role: 'operator' };
}
