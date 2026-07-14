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
  WORDPRESS_ROUTE_SECRET: 'cb69e1ec7ba2ed6641b122ca3af368823a941b99b5ea67c191c4e8e1923e1772',
  /** Session token lifetime. */
  JWT_TTL_SECONDS: 60 * 60 * 24 * 7,
};
