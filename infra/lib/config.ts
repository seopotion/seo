export type Stage = 'staging' | 'prod';

interface StageConfig {
  mongoDb: string; // logical DB name inside the cluster
  googleClientId: string; // public OAuth client id (per env)
  logLevel: string; // POWERTOOLS_LOG_LEVEL
  jwtSecretParam: string; // SSM SecureString NAME (not value)
  mongoUriParam: string; // SSM SecureString NAME (not value)
}

export const STAGE_CONFIG: Record<Stage, StageConfig> = {
  staging: {
    mongoDb: 'seo_staging',
    googleClientId: process.env.GOOGLE_CLIENT_ID_STAGING ?? '',
    logLevel: 'INFO',
    jwtSecretParam: '/seo/staging/jwt-secret',
    mongoUriParam: '/seo/staging/mongo-uri',
  },
  prod: {
    mongoDb: 'seo_prod',
    googleClientId: process.env.GOOGLE_CLIENT_ID_PROD ?? '',
    logLevel: 'INFO',
    jwtSecretParam: '/seo/prod/jwt-secret',
    mongoUriParam: '/seo/prod/mongo-uri',
  },
};
