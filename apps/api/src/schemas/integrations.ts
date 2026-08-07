import { z } from '@hono/zod-openapi';
import { DEFAULT_CONTENT_PATH } from '@shared/schemas';

/**
 * GitHub App install + static-site connect schemas (#7, design/github-app.md
 * § The install flow). Flow: GET /github/install-url -> github.com consent ->
 * the web callback POSTs the installation id back to /github/installation ->
 * the user picks a repo and branch -> POST /static-site finalizes.
 */
export const IntegrationOrgQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const IntegrationNotFoundResponse = z
  .object({ error: z.string().openapi({ example: 'Not found' }) })
  .openapi('IntegrationNotFoundResponse');

/** `code` is a GithubErrorCode (clients/github.ts) so the UI can say what to fix. */
export const IntegrationErrorResponse = z
  .object({
    error: z.string().openapi({ example: 'Invalid grant' }),
    code: z.string().openapi({ example: 'repo_not_found' }),
  })
  .openapi('IntegrationErrorResponse');

export const GithubInstallUrlResponse = z
  .object({ url: z.string() })
  .openapi('GithubInstallUrlResponse');

// org_id deliberately absent — it comes out of the state we signed, so the
// callback page never carries it. installation_id is checked against the state
// rather than trusted: it is a small sequential integer, not a secret.
export const GithubInstallationBody = z
  .object({
    installation_id: z.number().int().positive(),
    state: z.string(),
  })
  .openapi('GithubInstallationBody');

const GithubRepoSummary = z
  .object({
    full_name: z.string().openapi({ example: 'unmarble/unmarble-website' }),
    default_branch: z.string().openapi({ example: 'main' }),
    private: z.boolean(),
  })
  .openapi('GithubRepoSummary');

export const GithubInstallationResponse = z
  .object({
    repos: z.array(GithubRepoSummary),
    // Re-issued proof of the verified installation, carried by the connect body
    // below. Longer-lived than the state, because the user still has a repo and
    // a branch to choose.
    grant: z.string(),
  })
  .openapi('GithubInstallationResponse');

export const StaticSiteConnectBody = z
  .object({
    grant: z.string(),
    repo: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/, 'Expected "owner/name"')
      .openapi({ example: 'unmarble/unmarble-website' }),
    branch: z.string().min(1).openapi({ example: 'main' }),
    content_path: z.string().min(1).default(DEFAULT_CONTENT_PATH),
  })
  .openapi('StaticSiteConnectBody');

export const StaticSiteConnectResponse = z
  .object({ success: z.literal(true) })
  .openapi('StaticSiteConnectResponse');
