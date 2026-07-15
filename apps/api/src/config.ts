/** API version segment for mounted route paths. `as const` keeps the literal
 * type so the typed Hono client gets `client.api.v0.*` autocompletion. */
export const API_VERSION = 'v0' as const;

export const config = {
  /** Name of the SSM SecureString holding the HS256 signing secret in deployed
   * envs. When unset (local dev/tests), `JWT_SECRET` below is used directly so
   * no AWS access is needed. See `auth/secret.ts`. */
  JWT_SECRET_PARAM: process.env.JWT_SECRET_PARAM ?? '',
  /** Local-dev fallback signing secret, used only when JWT_SECRET_PARAM is unset. */
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  /** Google OAuth client id — the audience our login tokens are verified against. */
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  /** Name of the SSM SecureString holding the Google OAuth client secret in
   * deployed envs. Unset locally — GOOGLE_CLIENT_SECRET below is used directly. */
  GOOGLE_CLIENT_SECRET_PARAM: process.env.GOOGLE_CLIENT_SECRET_PARAM ?? '',
  /** Local-dev Google OAuth client secret (GSC authorization-code flow, #12). */
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  /** Name of the SSM SecureString holding the GSC token encryption key. */
  GSC_TOKEN_KEY_PARAM: process.env.GSC_TOKEN_KEY_PARAM ?? '',
  /** Local-dev GSC token key: 32 bytes, base64 (`openssl rand -base64 32`). */
  GSC_TOKEN_KEY: process.env.GSC_TOKEN_KEY ?? '',
  /** Web app origin — builds the GSC OAuth redirect URI (<origin>/dashboard/gsc/callback). */
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  /** Session token lifetime. */
  JWT_TTL_SECONDS: 60 * 60 * 24 * 7,
};
