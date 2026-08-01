import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { config } from '../config';

/**
 * GSC-flow secrets (#12), resolved with the same pattern as auth/secret.ts:
 * deployed envs read an SSM SecureString named by the *_PARAM env var (fetched
 * + decrypted via Powertools, cached ~1h); locally the plain env var is used
 * directly so no AWS access is needed.
 */
const SECRET_MAX_AGE_SECONDS = 3600;

async function resolve(paramName: string, fallback: string, label: string): Promise<string> {
  if (!paramName) return fallback;
  const value = await getParameter(paramName, { decrypt: true, maxAge: SECRET_MAX_AGE_SECONDS });
  if (!value) throw new Error(`SSM parameter ${paramName} (${label}) is missing or empty`);
  return value;
}

export async function getGoogleClientSecret(): Promise<string> {
  return resolve(
    config.GOOGLE_CLIENT_SECRET_PARAM,
    config.GOOGLE_CLIENT_SECRET,
    'google client secret',
  );
}

/** The 32-byte AES key for refresh-token encryption, stored base64-encoded. */
export async function getGscTokenKey(): Promise<Buffer> {
  const raw = await resolve(config.GSC_TOKEN_KEY_PARAM, config.GSC_TOKEN_KEY, 'gsc token key');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('GSC token key must decode to exactly 32 bytes (openssl rand -base64 32)');
  }
  return key;
}

/**
 * The GitHub App private key (#7, design/github-app.md § The private key): a
 * PKCS#1 PEM, signed with node:crypto because WebCrypto imports PKCS#8 only.
 * The `\n` unescaping is for the local `.env` path — SSM stores the PEM's real
 * newlines (`put-parameter --value file://…`), a dotenv line cannot.
 */
export async function getGithubAppKey(): Promise<string> {
  const raw = await resolve(config.GITHUB_APP_KEY_PARAM, config.GITHUB_APP_KEY, 'github app key');
  const pem = raw.replace(/\\n/g, '\n');
  if (!pem.includes('PRIVATE KEY')) {
    throw new Error('GitHub App key is not a PEM private key (GITHUB_APP_KEY / _PARAM)');
  }
  return pem;
}
