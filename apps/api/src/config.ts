/** API version segment for mounted route paths. `as const` keeps the literal
 * type so the typed Hono client gets `client.api.v0.*` autocompletion. */
export const API_VERSION = 'v0' as const;

export const config = {
  /** HS256 signing secret for our session JWTs. Set JWT_SECRET in every env. */
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  /** Google OAuth client id — the audience our login tokens are verified against. */
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  /** Session token lifetime. */
  JWT_TTL_SECONDS: 60 * 60 * 24 * 7,
};
