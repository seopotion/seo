import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { config } from '../config';

/** Same in-process cache TTL as the customer secret (see auth/secret.ts). */
const SECRET_MAX_AGE_SECONDS = 3600;

/** Short cache so allowlist edits in SSM apply without a redeploy. */
const ALLOWLIST_MAX_AGE_SECONDS = 300;

/**
 * Resolves the admin HS256 JWT signing secret — exact clone of the customer
 * pattern (auth/secret.ts) against the admin parameter. The admin secret is
 * granted to the admin Lambda ONLY; neither app can validate the other's
 * tokens.
 */
export async function getAdminJwtSecret(): Promise<string> {
  if (!config.ADMIN_JWT_SECRET_PARAM) return config.ADMIN_JWT_SECRET;

  const secret = await getParameter(config.ADMIN_JWT_SECRET_PARAM, {
    decrypt: true,
    maxAge: SECRET_MAX_AGE_SECONDS,
  });
  if (!secret) {
    throw new Error(`SSM parameter ${config.ADMIN_JWT_SECRET_PARAM} is missing or empty`);
  }
  return secret;
}

/**
 * The operator email allowlist: a comma-separated plain String SSM parameter
 * in deployed envs (short cache, see above), the `ADMIN_OPERATORS` env var
 * locally. Entries are trimmed + lowercased; empties dropped.
 */
export async function getOperatorAllowlist(): Promise<string[]> {
  const raw = config.ADMIN_OPERATORS_PARAM
    ? await getParameter(config.ADMIN_OPERATORS_PARAM, { maxAge: ALLOWLIST_MAX_AGE_SECONDS })
    : config.ADMIN_OPERATORS;
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
