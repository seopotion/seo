import { getParameter } from '@aws-lambda-powertools/parameters/ssm';

/**
 * In-process cache TTL for SSM-backed provider secrets. A warm Lambda hits SSM
 * at most once per hour per key, not once per invocation. Mirrors
 * apps/api/src/auth/secret.ts and packages/shared/db/src/mongo-uri.ts.
 */
const SECRET_MAX_AGE_SECONDS = 3600;

/**
 * Resolves a provider API credential by env-var name.
 *
 * Deployed: `<NAME>_PARAM` names an SSM SecureString; fetch + decrypt it via
 * Powertools (cached, see above), so the value stays out of the CloudFormation
 * template and out of the Lambda's environment. Local dev/tests: `<NAME>_PARAM`
 * is unset, so fall back to the plain `<NAME>` env var — no AWS access needed.
 *
 * Both apps/api and apps/worker build provider clients, hence the shared home.
 */
export async function resolveProviderSecret(name: string): Promise<string> {
  const param = process.env[`${name}_PARAM`];
  if (!param) return process.env[name] ?? '';

  const value = await getParameter(param, {
    decrypt: true,
    maxAge: SECRET_MAX_AGE_SECONDS,
  });
  if (!value) {
    throw new Error(`SSM parameter ${param} (${name}) is missing or empty`);
  }
  return value;
}
