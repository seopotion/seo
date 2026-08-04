/**
 * Pre-deploy prerequisite check for a backend environment (#16).
 *
 * The `SeoApiStack-<stage>` deploy assumes several things are provisioned
 * out-of-band (see `infra/ENVIRONMENTS.md`): twelve SSM SecureStrings per stage
 * (jwt-secret, mongo-uri, google-client-secret, gsc-token-key,
 * lemonsqueezy-api-key, lemonsqueezy-webhook-secret, admin/jwt-secret, and the
 * five provider credentials) plus the plain-String admin operator allowlist,
 * all resolved at Lambda
 * runtime, and public values baked into the Lambda env at synth time —
 * `GOOGLE_CLIENT_ID_<STAGE>`, `WEB_ORIGIN_<STAGE>` (the GSC OAuth redirect
 * base), and the LemonSqueezy store id + paid/expert variant ids. If any is
 * missing the stack still deploys but ships broken config. This verifies they
 * are present before `cdk deploy`.
 *
 * The names below mirror `infra/lib/config.ts` `STAGE_CONFIG` — `infra` is a
 * standalone package we can't import from the workspace, but the SSM naming is a
 * stable convention and the env vars read the identical names the stack config
 * reads.
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { ok, type PreflightResult, type PrereqCheck, type Result, type Stage } from '../types';

export const STAGES: Stage[] = ['staging', 'prod'];

function ssmParamNames(stage: Stage): string[] {
  return [
    `/seo/${stage}/jwt-secret`,
    `/seo/${stage}/mongo-uri`,
    `/seo/${stage}/google-client-secret`,
    `/seo/${stage}/gsc-token-key`,
    `/seo/${stage}/lemonsqueezy-api-key`,
    `/seo/${stage}/lemonsqueezy-webhook-secret`,
    // Admin Lambda (#150). Missing either one deploys a stack whose operator
    // login throws on every attempt — getAdminJwtSecret / getOperatorAllowlist
    // resolve them at runtime, so nothing else surfaces the gap.
    `/seo/${stage}/admin/jwt-secret`,
    `/seo/${stage}/admin/operators`,
    // Provider API credentials (#43). Resolved at runtime by @shared/providers
    // `resolveProviderSecret`; a missing one deploys workers that call every
    // provider with an empty key and fail only once a task is picked up.
    `/seo/${stage}/dataforseo-login`,
    `/seo/${stage}/dataforseo-password`,
    `/seo/${stage}/openrouter-api-key`,
    `/seo/${stage}/youtube-api-key`,
    `/seo/${stage}/fal-key`,
  ];
}

function googleClientIdVar(stage: Stage): string {
  return stage === 'prod' ? 'GOOGLE_CLIENT_ID_PROD' : 'GOOGLE_CLIENT_ID_STAGING';
}

function webOriginVar(stage: Stage): string {
  return stage === 'prod' ? 'WEB_ORIGIN_PROD' : 'WEB_ORIGIN_STAGING';
}

function lemonSqueezyStoreIdVar(stage: Stage): string {
  return stage === 'prod' ? 'LEMONSQUEEZY_STORE_ID_PROD' : 'LEMONSQUEEZY_STORE_ID_STAGING';
}

function lemonSqueezyVariantPaidVar(stage: Stage): string {
  return stage === 'prod' ? 'LEMONSQUEEZY_VARIANT_PAID_PROD' : 'LEMONSQUEEZY_VARIANT_PAID_STAGING';
}

function lemonSqueezyVariantExpertVar(stage: Stage): string {
  return stage === 'prod'
    ? 'LEMONSQUEEZY_VARIANT_EXPERT_PROD'
    : 'LEMONSQUEEZY_VARIANT_EXPERT_STAGING';
}

async function checkSsmParam(client: SSMClient, name: string): Promise<PrereqCheck> {
  try {
    // Presence-only: don't decrypt. A SecureString returns its (non-empty)
    // ciphertext without decryption, which is all we need to confirm it exists —
    // so the caller (the deploy role in CI) needs `ssm:GetParameter` but never
    // `kms:Decrypt`, and the secret value is never materialized just to count it.
    const res = await client.send(new GetParameterCommand({ Name: name, WithDecryption: false }));
    const value = res.Parameter?.Value;
    if (!value) {
      return { name, kind: 'ssm', present: false, error: 'resolved to an empty value' };
    }
    return { name, kind: 'ssm', present: true };
  } catch (e) {
    return { name, kind: 'ssm', present: false, error: (e as Error).message };
  }
}

function checkEnvVar(name: string): PrereqCheck {
  const value = process.env[name];
  return value
    ? { name, kind: 'env', present: true }
    : { name, kind: 'env', present: false, error: 'not set' };
}

export async function preflight(stage: Stage): Promise<Result<PreflightResult>> {
  const client = new SSMClient({});
  try {
    const ssmChecks = await Promise.all(
      ssmParamNames(stage).map((name) => checkSsmParam(client, name)),
    );
    const checks = [
      ...ssmChecks,
      checkEnvVar(googleClientIdVar(stage)),
      checkEnvVar(webOriginVar(stage)),
      checkEnvVar(lemonSqueezyStoreIdVar(stage)),
      checkEnvVar(lemonSqueezyVariantPaidVar(stage)),
      checkEnvVar(lemonSqueezyVariantExpertVar(stage)),
    ];
    return ok({ stage, ready: checks.every((c) => c.present), checks });
  } finally {
    client.destroy();
  }
}
