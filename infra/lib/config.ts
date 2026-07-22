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
  },
};
