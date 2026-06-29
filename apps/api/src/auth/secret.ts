import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { config } from '../config';

/**
 * In-process cache TTL for the SSM-backed signing secret. Powertools Parameters
 * caches the decrypted value for this long, so a warm Lambda hits SSM at most
 * once per hour — not once per request. The secret stays out of the
 * CloudFormation template (only its parameter NAME is an env var) and rotates
 * without a redeploy once the cache expires.
 */
const SECRET_MAX_AGE_SECONDS = 3600;

/**
 * Resolves the HS256 JWT signing secret.
 *
 * Deployed: `JWT_SECRET_PARAM` names an SSM SecureString; fetch + decrypt it via
 * Powertools (cached, see above). Local dev/tests: `JWT_SECRET_PARAM` is unset,
 * so fall back to the plain `JWT_SECRET` env var — no AWS access required.
 */
export async function getJwtSecret(): Promise<string> {
  if (!config.JWT_SECRET_PARAM) return config.JWT_SECRET;

  const secret = await getParameter(config.JWT_SECRET_PARAM, {
    decrypt: true,
    maxAge: SECRET_MAX_AGE_SECONDS,
  });
  if (!secret) {
    throw new Error(`SSM parameter ${config.JWT_SECRET_PARAM} is missing or empty`);
  }
  return secret;
}
