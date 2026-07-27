import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { verifyGoogleIdToken } from '../../clients/google';
import { logger } from '../../logger';
import { signAdminToken } from '../jwt';
import * as schemas from '../schemas';
import { getOperatorAllowlist } from '../secret';

/**
 * Operator login — the only public admin route. Google proves the identity
 * (same GOOGLE_CLIENT_ID audience as customer login); the SSM allowlist
 * decides authorization. Operators are NOT upserted into `users`.
 */
const login = new OpenAPIHono().openapi(
  createRoute({
    tags: ['admin'],
    method: 'post',
    path: '/login',
    summary: 'Exchange a Google ID token for an admin JWT (allowlist-gated)',
    request: {
      body: { content: { 'application/json': { schema: schemas.AdminLoginBody } }, required: true },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: schemas.AdminLoginResponse } },
        description: 'Admin JWT',
      },
      403: {
        content: { 'application/json': { schema: schemas.AdminErrorResponse } },
        description: 'Google account is not on the operator allowlist',
      },
    },
  }),
  async (c) => {
    const { id_token } = c.req.valid('json');
    const identity = await verifyGoogleIdToken(id_token);
    const email = identity.email.trim().toLowerCase();
    const allowlist = await getOperatorAllowlist();
    if (!allowlist.includes(email)) {
      logger.warn('admin login refused: not an operator', { email });
      return c.json({ error: 'not_an_operator' }, 403);
    }
    const token = await signAdminToken(email);
    return c.json({ token }, 200);
  },
);

export default login;
