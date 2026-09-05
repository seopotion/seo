import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { UserRepo } from '@shared/db';
import { isPaid } from '@shared/schemas';
import { signToken } from '../auth/jwt';
import { verifyGoogleIdToken } from '../clients/google';
import { listAccessibleOrgs } from '../lib/list-accessible-orgs';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/core';

/**
 * Core auth + account routes. `login` is public; the rest require a Bearer JWT.
 * See design/product-flow.md (Login & Subscribe).
 */
const core = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['core'],
      method: 'post',
      path: '/login',
      summary: 'Exchange a Google ID token for a session JWT',
      request: {
        body: { content: { 'application/json': { schema: schemas.LoginBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.LoginResponse } },
          description: 'Session JWT',
        },
      },
    }),
    async (c) => {
      const { id_token } = c.req.valid('json');
      const identity = await verifyGoogleIdToken(id_token);
      const user = await UserRepo.upsertByGoogleSub({
        google_sub: identity.sub,
        email: identity.email,
        name: identity.name,
      });
      const token = await signToken({ sub: user.id, email: user.email });
      return c.json({ token });
    },
  )
  .openapi(
    createRoute({
      tags: ['core'],
      method: 'get',
      path: '/organizations',
      summary: "List the authenticated user's organizations",
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.OrganizationsResponse } },
          description: 'Organizations (empty array means a fresh user — send them to setup)',
        },
      },
    }),
    async (c) => {
      const auth = c.get('auth');
      const orgs = await listAccessibleOrgs(auth);
      return c.json({
        organizations: orgs.map((o) => ({
          id: o.id,
          website_url: o.website_url,
          setup_status: o.setup_status,
          name: o.name,
          capabilities: {
            keyword_research: isPaid(o),
            keyword_scheduling: isPaid(o),
          },
          billing_tier: o.plan,
          role: o.user_id === auth.userId ? ('owner' as const) : ('member' as const),
        })),
      });
    },
  )
  .openapi(
    createRoute({
      tags: ['core'],
      method: 'get',
      path: '/status',
      summary: 'Whether the user has completed setup (dashboard gate)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.CoreStatusResponse } },
          description: 'setup_complete=true -> dashboard, otherwise -> setup',
        },
      },
    }),
    async (c) => {
      const orgs = await listAccessibleOrgs(c.get('auth'));
      const setup_complete = orgs.some((o) => o.setup_status === 'setup_complete');
      return c.json({ setup_complete });
    },
  );

export default core;
