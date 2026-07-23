import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { type BillingProvider, createLemonSqueezyProvider } from '@shared/providers';
import { config } from '../config';

const SECRET_MAX_AGE_SECONDS = 3600;

/** Resolve an SSM SecureString by name (deployed) or fall back to a plain env
 * value (local dev/tests) — mirrors auth/secret.ts. */
async function resolveSecret(paramName: string, fallback: string): Promise<string> {
  if (!paramName) return fallback;
  const value = await getParameter(paramName, { decrypt: true, maxAge: SECRET_MAX_AGE_SECONDS });
  if (!value) throw new Error(`SSM parameter ${paramName} is missing or empty`);
  return value;
}

/**
 * LemonSqueezy provider with secrets resolved via SSM in deployed envs, plain
 * env vars locally. Built per call (construction is cheap) so a rotated
 * SecureString takes effect once Powertools' ~1h cache expires — do NOT cache
 * the provider itself; it closes over the secrets. API Lambda only — the
 * worker is never granted these params.
 */
export async function getBillingProvider(): Promise<BillingProvider> {
  const [apiKey, webhookSecret] = await Promise.all([
    resolveSecret(config.LEMONSQUEEZY_API_KEY_PARAM, config.LEMONSQUEEZY_API_KEY),
    resolveSecret(config.LEMONSQUEEZY_WEBHOOK_SECRET_PARAM, config.LEMONSQUEEZY_WEBHOOK_SECRET),
  ]);
  return createLemonSqueezyProvider({
    apiKey,
    webhookSecret,
    storeId: config.LEMONSQUEEZY_STORE_ID,
    variantByTier: {
      paid: config.LEMONSQUEEZY_VARIANT_PAID,
      expert: config.LEMONSQUEEZY_VARIANT_EXPERT,
    },
    // The page that polls entitlement after checkout — see apps/web /billing.
    redirectUrl: `${config.WEB_ORIGIN}/billing?checkout=success`,
  });
}
