import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { verifyToken } from '../auth/jwt';

export interface AuthContext {
  userId: string;
  email: string;
}

export type AuthEnv = { Variables: { auth: AuthContext } };

/**
 * Validates `Authorization: Bearer <jwt>` and puts the user on `c.var.auth`.
 * Throws 401 on missing/invalid token (Hono renders the HTTPException).
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing bearer token' });
  }

  try {
    const claims = await verifyToken(header.slice('Bearer '.length));
    c.set('auth', { userId: claims.sub, email: claims.email });
  } catch {
    throw new HTTPException(401, { message: 'Invalid token' });
  }

  await next();
});
