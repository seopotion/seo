import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { type AdminRole, verifyAdminToken } from './jwt';

export interface AdminAuthContext {
  email: string;
  role: AdminRole;
}

export type AdminEnv = { Variables: { adminAuth: AdminAuthContext } };

/**
 * Validates `Authorization: Bearer <admin jwt>` and puts the operator on
 * `c.var.adminAuth`. Mirrors middlewares/auth.ts, but verifies against the
 * separate admin secret — customer tokens fail here cryptographically.
 * Registered router-globally in admin/index.ts (fail-closed), not per route.
 */
export const adminAuthMiddleware = createMiddleware<AdminEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing bearer token' });
  }

  try {
    const claims = await verifyAdminToken(header.slice('Bearer '.length));
    c.set('adminAuth', { email: claims.email, role: claims.role });
  } catch {
    throw new HTTPException(401, { message: 'Invalid token' });
  }

  await next();
});
