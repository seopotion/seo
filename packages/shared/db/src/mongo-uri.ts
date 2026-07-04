import { getParameter } from '@aws-lambda-powertools/parameters/ssm';

/**
 * In-process cache TTL for the SSM-backed connection string. Warm Lambdas hit
 * SSM at most once per hour, and the credentials stay out of the template.
 * Mirrors apps/api/src/auth/secret.ts.
 */
const MONGO_URI_MAX_AGE_SECONDS = 3600;

/**
 * Resolves the Mongo connection string.
 *
 * Deployed: `MONGO_URI_PARAM` names an SSM SecureString; fetch + decrypt it via
 * Powertools (cached, see above). Local dev/tests: `MONGO_URI_PARAM` is unset,
 * so fall back to the plain `MONGO_URI` env var (default localhost) — no AWS.
 */
export async function resolveMongoUri(): Promise<string> {
  const param = process.env.MONGO_URI_PARAM;
  if (!param) {
    return process.env.MONGO_URI ?? 'mongodb://localhost:27017';
  }

  const uri = await getParameter(param, {
    decrypt: true,
    maxAge: MONGO_URI_MAX_AGE_SECONDS,
  });
  if (!uri) {
    throw new Error(`SSM parameter ${param} is missing or empty`);
  }
  return uri;
}
