import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { GscConnectionRepo } from '@shared/db';
import * as gsc from '../clients/gsc';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { signGscState, verifyGscState } from '../lib/gsc-state';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { getGscTokenKey } from '../lib/secrets';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/gsc';

/**
 * Google Search Console connect flow (#12, design/product-flow.md §1 + §2.6).
 * Mounted at /dashboard/gsc. All routes require a Bearer JWT and org ownership.
 */
const gscRoutes = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'get',
      path: '/auth-url',
      summary: 'Google consent URL for connecting Search Console',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.GscOrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscAuthUrlResponse } },
          description: 'Consent URL (offline access, webmasters.readonly, signed state)',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const state = await signGscState({ org_id, user_id: userId });
      return c.json({ url: await gsc.buildAuthUrl(state) }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'post',
      path: '/connect',
      summary: 'Exchange the OAuth callback code; returns the account properties to pick from',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.GscConnectBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscConnectResponse } },
          description: 'Token stored (site pending); the GSC properties of the Google account',
        },
        400: {
          content: { 'application/json': { schema: schemas.GscErrorResponse } },
          description: 'Invalid/expired state or failed Google code exchange',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'State org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { code, state } = c.req.valid('json');
      const { userId } = c.get('auth');

      let claims: { org_id: string; user_id: string };
      try {
        claims = await verifyGscState(state);
      } catch {
        return c.json({ error: 'Invalid state' }, 400);
      }
      // The state must have been minted by this same user's session.
      if (claims.user_id !== userId) return c.json({ error: 'Invalid state' }, 400);
      const org = await loadOwnedOrg(claims.org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      let tokens: { refreshToken: string; email: string };
      try {
        tokens = await gsc.exchangeCode(code);
      } catch {
        return c.json({ error: 'Google code exchange failed' }, 400);
      }

      const enc = encryptSecret(tokens.refreshToken, await getGscTokenKey());
      await GscConnectionRepo.upsertToken(claims.org_id, enc, tokens.email);
      const sites = await gsc.listSites(tokens.refreshToken);
      return c.json({ org_id: claims.org_id, sites }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'post',
      path: '/site',
      summary: 'Finalize the connection with the chosen GSC property',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.GscSiteBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscOkResponse } },
          description: 'Connection complete — the GSC gate opens',
        },
        400: {
          content: { 'application/json': { schema: schemas.GscErrorResponse } },
          description: 'No pending connection, or the site is not in the Google account',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id, site_url } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const conn = await GscConnectionRepo.findByOrgId(org_id);
      if (!conn) return c.json({ error: 'No pending connection' }, 400);

      // Validate against a fresh list so a forged site_url can't be stored.
      const refreshToken = decryptSecret(conn.refresh_token_enc, await getGscTokenKey());
      const sites = await gsc.listSites(refreshToken);
      if (!sites.some((s) => s.site_url === site_url)) {
        return c.json({ error: 'Site not in this Google account' }, 400);
      }

      await GscConnectionRepo.setSiteUrl(org_id, site_url);
      return c.json({ ok: true }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['gsc'],
      method: 'delete',
      path: '/',
      summary: 'Disconnect Search Console (deletes the stored token)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.GscOrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GscOkResponse } },
          description: 'ok=true when a connection existed',
        },
        404: {
          content: { 'application/json': { schema: schemas.GscNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      const ok = await GscConnectionRepo.deleteByOrgId(org_id);
      return c.json({ ok }, 200);
    },
  );

export default gscRoutes;
