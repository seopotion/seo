/**
 * Pre-deploy prerequisite check for a backend environment (#16).
 *
 * The `SeoApiStack-<stage>` deploy assumes four things are provisioned
 * out-of-band (see `infra/ENVIRONMENTS.md`): two SSM SecureStrings per stage
 * (jwt-secret, mongo-uri) resolved at Lambda runtime, and the public
 * `GOOGLE_CLIENT_ID_<STAGE>` baked into the Lambda env at synth time. If any is
 * missing the stack still deploys but ships broken config. This verifies they
 * are present before `cdk deploy`.
 *
 * The names below mirror `infra/lib/config.ts` `STAGE_CONFIG` — `infra` is a
 * standalone package we can't import from the workspace, but the SSM naming is a
 * stable convention and the google client id reads the identical env var the
 * stack config reads.
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { ok, type PreflightResult, type PrereqCheck, type Result, type Stage } from '../types';

export const STAGES: Stage[] = ['staging', 'prod'];

function ssmParamNames(stage: Stage): string[] {
  return [`/seo/${stage}/jwt-secret`, `/seo/${stage}/mongo-uri`];
}

function googleClientIdVar(stage: Stage): string {
  return stage === 'prod' ? 'GOOGLE_CLIENT_ID_PROD' : 'GOOGLE_CLIENT_ID_STAGING';
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

function checkGoogleClientId(stage: Stage): PrereqCheck {
  const name = googleClientIdVar(stage);
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
    const checks = [...ssmChecks, checkGoogleClientId(stage)];
    return ok({ stage, ready: checks.every((c) => c.present), checks });
  } finally {
    client.destroy();
  }
}
