export type Stage = 'staging' | 'prod';

interface StageConfig {
  mongoDb: string; // logical DB name inside the cluster
  googleClientId: string; // public OAuth client id (per env)
  logLevel: string; // POWERTOOLS_LOG_LEVEL
  jwtSecretParam: string; // SSM SecureString NAME (not value)
  mongoUriParam: string; // SSM SecureString NAME (not value)
  googleClientSecretParam: string; // SSM SecureString NAME (not value)
  gscTokenKeyParam: string; // SSM SecureString NAME (not value)
  webOrigin: string; // web app origin — GSC OAuth redirect URI base
  lemonSqueezyApiKeyParam: string; // SSM SecureString NAME
  lemonSqueezyWebhookSecretParam: string; // SSM SecureString NAME
  lemonSqueezyStoreId: string; // public
  lemonSqueezyVariantPaid: string; // public
  lemonSqueezyVariantExpert: string; // public
  adminJwtSecretParam: string; // SSM SecureString NAME (admin Lambda only)
  adminOperatorsParam: string; // SSM String NAME — comma-separated operator emails
  githubAppSlug: string; // public — builds the App install URL
  githubAppClientId: string; // public — the App JWT `iss`
  githubAppKeyParam: string; // SSM SecureString NAME (not value)
  // Provider API credentials — SSM SecureString NAMEs, resolved at runtime by
  // @shared/providers `resolveProviderSecret` (#43). Never values: these used to
  // be baked into the Lambda env at synth time, which put them in the template.
  dataForSeoLoginParam: string;
  dataForSeoPasswordParam: string;
  openRouterApiKeyParam: string;
  youtubeApiKeyParam: string;
  falKeyParam: string;
}

export const STAGE_CONFIG: Record<Stage, StageConfig> = {
  staging: {
    mongoDb: 'seo_staging',
    googleClientId: process.env.GOOGLE_CLIENT_ID_STAGING ?? '',
    logLevel: 'INFO',
    jwtSecretParam: '/seo/staging/jwt-secret',
    mongoUriParam: '/seo/staging/mongo-uri',
    googleClientSecretParam: '/seo/staging/google-client-secret',
    gscTokenKeyParam: '/seo/staging/gsc-token-key',
    webOrigin: process.env.WEB_ORIGIN_STAGING ?? '',
    lemonSqueezyApiKeyParam: '/seo/staging/lemonsqueezy-api-key',
    lemonSqueezyWebhookSecretParam: '/seo/staging/lemonsqueezy-webhook-secret',
    lemonSqueezyStoreId: process.env.LEMONSQUEEZY_STORE_ID_STAGING ?? '',
    lemonSqueezyVariantPaid: process.env.LEMONSQUEEZY_VARIANT_PAID_STAGING ?? '',
    lemonSqueezyVariantExpert: process.env.LEMONSQUEEZY_VARIANT_EXPERT_STAGING ?? '',
    adminJwtSecretParam: '/seo/staging/admin/jwt-secret',
    adminOperatorsParam: '/seo/staging/admin/operators',
    // One GitHub App per environment (#7, design/github-app.md § Registration).
    // Empty until the App is registered by hand — the install-url route 503s
    // rather than sending anyone to a github.com 404.
    githubAppSlug: process.env.GH_APP_SLUG_STAGING ?? '',
    githubAppClientId: process.env.GH_APP_CLIENT_ID_STAGING ?? '',
    githubAppKeyParam: '/seo/staging/github-app-key',
    dataForSeoLoginParam: '/seo/staging/dataforseo-login',
    dataForSeoPasswordParam: '/seo/staging/dataforseo-password',
    openRouterApiKeyParam: '/seo/staging/openrouter-api-key',
    youtubeApiKeyParam: '/seo/staging/youtube-api-key',
    falKeyParam: '/seo/staging/fal-key',
  },
  prod: {
    mongoDb: 'seo_prod',
    googleClientId: process.env.GOOGLE_CLIENT_ID_PROD ?? '',
    logLevel: 'INFO',
    jwtSecretParam: '/seo/prod/jwt-secret',
    mongoUriParam: '/seo/prod/mongo-uri',
    googleClientSecretParam: '/seo/prod/google-client-secret',
    gscTokenKeyParam: '/seo/prod/gsc-token-key',
    webOrigin: process.env.WEB_ORIGIN_PROD ?? '',
    lemonSqueezyApiKeyParam: '/seo/prod/lemonsqueezy-api-key',
    lemonSqueezyWebhookSecretParam: '/seo/prod/lemonsqueezy-webhook-secret',
    lemonSqueezyStoreId: process.env.LEMONSQUEEZY_STORE_ID_PROD ?? '',
    lemonSqueezyVariantPaid: process.env.LEMONSQUEEZY_VARIANT_PAID_PROD ?? '',
    lemonSqueezyVariantExpert: process.env.LEMONSQUEEZY_VARIANT_EXPERT_PROD ?? '',
    adminJwtSecretParam: '/seo/prod/admin/jwt-secret',
    adminOperatorsParam: '/seo/prod/admin/operators',
    githubAppSlug: process.env.GH_APP_SLUG_PROD ?? '',
    githubAppClientId: process.env.GH_APP_CLIENT_ID_PROD ?? '',
    githubAppKeyParam: '/seo/prod/github-app-key',
    dataForSeoLoginParam: '/seo/prod/dataforseo-login',
    dataForSeoPasswordParam: '/seo/prod/dataforseo-password',
    openRouterApiKeyParam: '/seo/prod/openrouter-api-key',
    youtubeApiKeyParam: '/seo/prod/youtube-api-key',
    falKeyParam: '/seo/prod/fal-key',
  },
};

// ---------------------------------------------------------------------------
// Frontend (SeoWebStack) — #35. First domainNames entry is the certificate
// primary and canonical host; the rest are SANs.
export interface WebStageConfig {
  domainNames: string[];
  apexRedirect?: { from: string; to: string };
}

export const WEB_STAGE_CONFIG: Record<Stage, WebStageConfig> = {
  staging: { domainNames: ['staging.seopotion.co'] },
  prod: {
    domainNames: ['www.seopotion.co', 'seopotion.co'],
    apexRedirect: { from: 'seopotion.co', to: 'www.seopotion.co' },
  },
};
