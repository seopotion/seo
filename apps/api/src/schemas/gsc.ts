import { z } from '@hono/zod-openapi';

/**
 * GSC connect-flow schemas (#12). Flow: GET /auth-url -> Google consent ->
 * web callback POSTs the code to /connect -> user picks a property ->
 * POST /site finalizes. The connection gates the Home Best Articles /
 * Search Performance cards (see schemas/dashboard.ts).
 */
export const GscOrgQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const GscNotFoundResponse = z
  .object({ error: z.string().openapi({ example: 'Not found' }) })
  .openapi('GscNotFoundResponse');

export const GscErrorResponse = z
  .object({ error: z.string().openapi({ example: 'Invalid state' }) })
  .openapi('GscErrorResponse');

export const GscAuthUrlResponse = z.object({ url: z.string() }).openapi('GscAuthUrlResponse');

// org_id deliberately absent: the server takes it from the verified state, so
// the callback page never has to carry (or be trusted with) it.
export const GscConnectBody = z
  .object({ code: z.string(), state: z.string() })
  .openapi('GscConnectBody');

const GscSite = z.object({ site_url: z.string(), permission_level: z.string() }).openapi('GscSite');

export const GscConnectResponse = z
  .object({ org_id: z.string(), sites: z.array(GscSite) })
  .openapi('GscConnectResponse');

export const GscSiteBody = z
  .object({ org_id: z.string(), site_url: z.string() })
  .openapi('GscSiteBody');

export const GscOkResponse = z.object({ ok: z.boolean() }).openapi('GscOkResponse');

export const GscStatusResponse = z
  .object({
    connected: z.boolean(),
    google_email: z.string().nullable(),
    site_url: z.string().nullable(),
    connected_at: z.string().nullable(),
    needs_reconnect: z.boolean(),
  })
  .openapi('GscStatusResponse');
