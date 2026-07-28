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
  /** Route-wide shared secret for the WordPress publishing endpoints, sent as
   * `X-Secret-Key`. Hardcoded so staging matches automatically — must equal the
   * value baked into the WordPress plugin. */
  WORDPRESS_ROUTE_SECRET: 'cb69e1ec7ba2ed6641b122ca3af368823a941b99b5ea67c191c4e8e1923e1772',
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
  /** Name of the SSM SecureString holding the LemonSqueezy API key (deployed).
   * Unset locally — LEMONSQUEEZY_API_KEY below is used directly. */
  LEMONSQUEEZY_API_KEY_PARAM: process.env.LEMONSQUEEZY_API_KEY_PARAM ?? '',
  /** Local-dev LemonSqueezy API key (#13). */
  LEMONSQUEEZY_API_KEY: process.env.LEMONSQUEEZY_API_KEY ?? '',
  /** Name of the SSM SecureString holding the LemonSqueezy webhook signing secret. */
  LEMONSQUEEZY_WEBHOOK_SECRET_PARAM: process.env.LEMONSQUEEZY_WEBHOOK_SECRET_PARAM ?? '',
  /** Local-dev LemonSqueezy webhook signing secret (#13). */
  LEMONSQUEEZY_WEBHOOK_SECRET: process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '',
  /** LemonSqueezy store id (public, per-env). */
  LEMONSQUEEZY_STORE_ID: process.env.LEMONSQUEEZY_STORE_ID ?? '',
  /** LemonSqueezy variant ids per paid tier (public, per-env). */
  LEMONSQUEEZY_VARIANT_PAID: process.env.LEMONSQUEEZY_VARIANT_PAID ?? '',
  LEMONSQUEEZY_VARIANT_EXPERT: process.env.LEMONSQUEEZY_VARIANT_EXPERT ?? '',
  /** Session token lifetime. */
  JWT_TTL_SECONDS: 60 * 60 * 24 * 7,
  /** Name of the SSM SecureString holding the admin HS256 signing secret in
   * deployed envs (granted to the admin Lambda ONLY). Unset locally —
   * ADMIN_JWT_SECRET below is used directly. See admin/secret.ts. */
  ADMIN_JWT_SECRET_PARAM: process.env.ADMIN_JWT_SECRET_PARAM ?? '',
  /** Local-dev admin signing secret. Deliberately different from JWT_SECRET's
   * default so customer/admin cross-token tests are meaningful locally. */
  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET ?? 'dev-admin-secret-change-me',
  /** Name of the SSM String parameter holding the comma-separated operator
   * email allowlist in deployed envs. Unset locally — ADMIN_OPERATORS is used. */
  ADMIN_OPERATORS_PARAM: process.env.ADMIN_OPERATORS_PARAM ?? '',
  /** Local-dev operator allowlist (comma-separated emails). */
  ADMIN_OPERATORS: process.env.ADMIN_OPERATORS ?? '',
  /** Admin session token lifetime. */
  ADMIN_JWT_TTL_SECONDS: 60 * 60 * 12,
};
