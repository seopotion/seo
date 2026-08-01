import { z } from 'zod';

/**
 * Publishing targets we can actually connect to and write into. A strict subset
 * of `ONBOARDING_INTEGRATIONS` (org.ts), which also lists platforms we only ask
 * about at onboarding (`wordpress-com`, `framer`). See design/integrations-model.md.
 */
export const INTEGRATION_PROVIDERS = ['wordpress', 'static-site'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * Where a static-site integration puts Markdown + manifest.json in the client's
 * repo. Applied at the connect route, never in the entity below: a stored
 * document always carries the literal path it was connected with, so changing
 * this default later cannot silently repoint an existing install's files.
 */
export const DEFAULT_CONTENT_PATH = 'seopotion/';

const IntegrationBase = z.object({
  id: z.string(),
  org_id: z.string(),
  connected_at: z.date(),
  // Last failure from a publish or a connectivity check; cleared on success.
  // Lets the UI show "connected but broken" instead of failing silently later.
  last_error: z.object({ code: z.string(), at: z.date() }).nullable().default(null),
});

/**
 * One publishing connection, keyed by (org, provider). A top-level discriminated
 * union rather than a nested `config` object: `provider` stays a plain field, so
 * the Mongo query and its unique index are not dotted paths, and the common
 * fields read without narrowing.
 */
export const IntegrationSchema = z.discriminatedUnion('provider', [
  IntegrationBase.extend({
    provider: z.literal('wordpress'),
    // Denormalized from org.website_url at connect time: the org's URL can
    // change, the site we hold a token for cannot.
    site_url: z.string().url(),
    // AES-256-GCM (apps/api lib/crypto.ts). The plaintext mirror on the org is
    // still what the publish paths read — see design/integrations-model.md.
    token_enc: z.string(),
  }),
  IntegrationBase.extend({
    provider: z.literal('static-site'),
    // The git host is a field, not a provider: the content contract is
    // host-neutral, so GitLab/Bitbucket would be a new value here.
    host: z.literal('github'),
    // A GitHub App installation token lives ~1h, so we store only the
    // installation id and mint per publish. No secret at rest.
    installation_id: z.number().int().positive(),
    repo: z.string(), // "owner/name"
    branch: z.string(),
    // The one contract path (design/static-site-integration.md § The contract).
    // Images are not committed — they stay on our CDN, referenced absolutely.
    content_path: z.string(),
  }),
]);
export type Integration = z.infer<typeof IntegrationSchema>;
