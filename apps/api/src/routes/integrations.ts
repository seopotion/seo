import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { IntegrationRepo } from '@shared/db';
import {
  GithubError,
  getInstallation,
  listInstallationRepos,
  verifyRepoAccess,
} from '../clients/github';
import { config } from '../config';
import {
  type GithubInstallGrant,
  signInstallGrant,
  signInstallState,
  verifyInstallGrant,
  verifyInstallState,
} from '../lib/github-state';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/integrations';

/**
 * GitHub App install flow + static-site connect (#7, design/github-app.md).
 * Mounted at /dashboard/integrations, alongside the WordPress connect,
 * connected-list and disconnect routes that live in routes/dashboard.ts.
 *
 * All three require a Bearer JWT and org ownership.
 */

/**
 * How recently the installation must have been created or reconfigured for the
 * callback to accept it. GitHub does not sign the Setup URL redirect, so
 * `installation_id` reaches us as a client-supplied integer — and a small
 * sequential one, i.e. enumerable. The signed state proves *an* install flow
 * started for this org; this proves the installation being claimed is the one
 * that flow just produced, rather than a stranger's guessed id.
 *
 * Deliberately looser than the state's 10-minute TTL: the state is the tighter
 * bound, and this only needs to exclude installations that predate the flow.
 */
const INSTALL_FRESHNESS_MS = 15 * 60_000;

/** GithubError -> HTTP: 502 when our call failed, 422 when GitHub said no. */
function githubFailure(err: unknown): { status: 422 | 502; body: { error: string; code: string } } {
  if (err instanceof GithubError) {
    return {
      status: err.code === 'github_request_failed' ? 502 : 422,
      body: { error: err.message, code: err.code },
    };
  }
  return { status: 502, body: { error: 'GitHub request failed', code: 'github_request_failed' } };
}

const integrationsRoutes = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['integrations'],
      method: 'get',
      path: '/github/install-url',
      summary: 'GitHub App install URL, carrying a signed state',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.IntegrationOrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GithubInstallUrlResponse } },
          description: 'Send the user here to pick an account and repositories',
        },
        404: {
          content: { 'application/json': { schema: schemas.IntegrationNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
        503: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'No GitHub App is registered for this environment',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);
      // One App per environment, registered by hand; until that happens there is
      // no slug to build a URL from, and an empty one would 404 on github.com.
      if (!config.GITHUB_APP_SLUG) {
        return c.json(
          { error: 'GitHub App is not configured', code: 'github_app_not_configured' },
          503,
        );
      }

      const state = await signInstallState({ org_id, user_id: userId });
      const url = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
      return c.json({ url }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['integrations'],
      method: 'post',
      path: '/github/installation',
      summary: 'Redeem the install callback; returns the repos to pick from',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.GithubInstallationBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.GithubInstallationResponse } },
          description: 'The installation repositories, plus a grant for the connect call',
        },
        400: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'Invalid or expired state, or an installation this flow did not create',
        },
        404: {
          content: { 'application/json': { schema: schemas.IntegrationNotFoundResponse } },
          description: 'State org not found or not owned by the caller',
        },
        422: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'GitHub refused: installation gone or suspended',
        },
        502: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'GitHub request failed',
        },
      },
    }),
    async (c) => {
      const { installation_id, state } = c.req.valid('json');
      const { userId } = c.get('auth');

      let claims: { org_id: string; user_id: string };
      try {
        claims = await verifyInstallState(state);
      } catch {
        return c.json({ error: 'Invalid state', code: 'invalid_state' }, 400);
      }
      // The state must have been minted by this same user's session.
      if (claims.user_id !== userId) {
        return c.json({ error: 'Invalid state', code: 'invalid_state' }, 400);
      }
      const org = await loadOwnedOrg(claims.org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      try {
        const installation = await getInstallation(installation_id);
        const touchedAt = Math.max(
          installation.created_at.getTime(),
          installation.updated_at.getTime(),
        );
        if (Date.now() - touchedAt > INSTALL_FRESHNESS_MS) {
          return c.json(
            {
              error: 'This installation was not created by this connect flow — start again',
              code: 'stale_installation',
            },
            400,
          );
        }

        const repos = await listInstallationRepos(installation_id);
        const grant = await signInstallGrant({ ...claims, installation_id });
        return c.json({ repos, grant }, 200);
      } catch (err) {
        const fail = githubFailure(err);
        return fail.status === 502 ? c.json(fail.body, 502) : c.json(fail.body, 422);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['integrations'],
      method: 'post',
      path: '/static-site',
      summary: 'Connect a static site: commit articles into a repo branch',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.StaticSiteConnectBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.StaticSiteConnectResponse } },
          description: 'Verified and stored',
        },
        400: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'Invalid or expired grant',
        },
        404: {
          content: { 'application/json': { schema: schemas.IntegrationNotFoundResponse } },
          description: 'Grant org not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'That installation is already connected to another organization',
        },
        422: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'GitHub refused: repo/branch unreachable, or no write permission',
        },
        502: {
          content: { 'application/json': { schema: schemas.IntegrationErrorResponse } },
          description: 'GitHub request failed',
        },
      },
    }),
    async (c) => {
      const { grant, repo, branch, content_path } = c.req.valid('json');
      const { userId } = c.get('auth');

      // org_id and installation_id both come out of the grant: a client cannot
      // name either one, which is what closes the installation-claim hole.
      let claims: GithubInstallGrant;
      try {
        claims = await verifyInstallGrant(grant);
      } catch {
        return c.json({ error: 'Invalid grant', code: 'invalid_grant' }, 400);
      }
      if (claims.user_id !== userId) {
        return c.json({ error: 'Invalid grant', code: 'invalid_grant' }, 400);
      }
      const org = await loadOwnedOrg(claims.org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      // Verify before you save: mint the scoped token and read the branch, so a
      // connection that cannot publish fails here rather than at the first
      // publish (design/integrations-model.md § API surface).
      try {
        await verifyRepoAccess(claims.installation_id, repo, branch);
      } catch (err) {
        const fail = githubFailure(err);
        return fail.status === 502 ? c.json(fail.body, 502) : c.json(fail.body, 422);
      }

      const stored = await IntegrationRepo.connectStaticSite(org.id, {
        installationId: claims.installation_id,
        repo,
        branch,
        contentPath: content_path,
      });
      if (!stored) {
        return c.json(
          {
            error: 'This GitHub installation is already connected to another organization',
            code: 'installation_claimed',
          },
          409,
        );
      }
      return c.json({ success: true as const }, 200);
    },
  );

export default integrationsRoutes;
