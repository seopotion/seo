# Backend environments

Two stacks, one AWS account (`personal` / 859998284061 / us-east-1):

- `SeoApiStack-staging` — deployed on merge `dev` → `master`. (Pushes to `dev` deploy nothing.)
- `SeoApiStack-prod` — deployed by publishing a GitHub Release / tag. Deferred, not yet wired — see [#43](https://github.com/seopotion/seo/issues/43).

Config lives in `infra/lib/config.ts` (non-secret values + SSM parameter NAMES).
Secret values are provisioned out-of-band and resolved at Lambda runtime.

## One-time prerequisites (per account)

1. **Two Atlas clusters** (staging, prod) → two connection strings.
2. **SSM SecureStrings** (values never enter CloudFormation). Generate each
   JWT secret with `openssl rand -base64 32`:

   ```sh
   aws ssm put-parameter --name /seo/staging/mongo-uri  --type SecureString --value '<staging-conn-str>'
   aws ssm put-parameter --name /seo/staging/jwt-secret --type SecureString --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --name /seo/prod/mongo-uri     --type SecureString --value '<prod-conn-str>'
   aws ssm put-parameter --name /seo/prod/jwt-secret    --type SecureString --value "$(openssl rand -base64 32)"
   ```

3. **Two Google OAuth client IDs** (staging vs prod) — see [Google OAuth
   clients](#google-oauth-clients) below. Set each as a GitHub Actions repo
   **variable** `GOOGLE_CLIENT_ID_STAGING` / `GOOGLE_CLIENT_ID_PROD` (public, not
   secrets):

   ```sh
   gh variable set GOOGLE_CLIENT_ID_STAGING --repo seopotion/seo --body '<staging-client-id>'
   gh variable set GOOGLE_CLIENT_ID_PROD    --repo seopotion/seo --body '<prod-client-id>'
   ```

4. **GitHub OIDC provider + deploy role** — see [GitHub OIDC deploy
   role](#github-oidc-deploy-role) below. Store its ARN and the account id as
   secrets:

   ```sh
   gh secret set AWS_ACCOUNT_ID     --repo seopotion/seo --body '859998284061'
   gh secret set AWS_DEPLOY_ROLE_ARN --repo seopotion/seo --body 'arn:aws:iam::859998284061:role/github-actions-seo-deploy'
   ```

## Google OAuth clients

Login is the Google Identity Services **ID-token** flow (`google.accounts.id` →
`id_token` → `POST /core/login`), so the OAuth client needs **Authorized
JavaScript origins only** — leave **Authorized redirect URIs empty** (the flow
never redirects). Create one **Web application** client per environment
(`console.cloud.google.com` → APIs & Services → Credentials):

| Field                        | Staging                                            |
| ---------------------------- | -------------------------------------------------- |
| Name (internal)              | `SEO Potion — staging (web)`                        |
| Authorized JS origins        | `http://localhost:3000`, `https://app-staging.seopotion.co` |
| Authorized redirect URIs     | *(none)*                                            |

- Origins are `scheme://host[:port]` — **no trailing slash, no path**; HTTPS
  except `localhost`. Add the generated CloudFront origin once the frontend
  sub-project (C) deploys staging — origins are editable without recreating the
  client. Prod mirrors this with `app.seopotion.co`.
- If the **OAuth consent screen** is in *Testing* mode, only listed test users
  can sign in — add your test accounts or publish the app.
- The same client id is also the frontend's `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (#21).

## GitHub OIDC deploy role

One-time, with admin AWS credentials. Bootstrap CDK (creates the execution roles
the deploy assumes), create the OIDC provider if absent, then a role scoped to
this repo's `dev`/`master` branches:

```sh
cd infra && npx cdk bootstrap aws://859998284061/us-east-1

# Only one provider per URL per account — skip if `aws iam list-open-id-connect-providers` shows it:
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 1c58a3a8518e8759bf075b76b750d4f2df264fca

cat > /tmp/trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::859998284061:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": [
        "repo:seopotion/seo:ref:refs/heads/dev",
        "repo:seopotion/seo:ref:refs/heads/master"
      ]}
    }
  }]
}
JSON

cat > /tmp/perms.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::859998284061:role/cdk-hnb659fds-*"
    },
    {
      "Sid": "PreflightReadSsm",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:us-east-1:859998284061:parameter/seo/*"
    }
  ]
}
JSON

aws iam create-role --role-name github-actions-seo-deploy \
  --assume-role-policy-document file:///tmp/trust.json
aws iam put-role-policy --role-name github-actions-seo-deploy \
  --policy-name cdk-deploy --policy-document file:///tmp/perms.json
```

Two grants: the role **assumes the CDK bootstrap roles** (`cdk-hnb659fds-*`) — the
CDK CLI does the actual deploy through them — and reads `/seo/*` SSM parameters so
the preflight step can verify they exist. It deliberately has **no `kms:Decrypt`**:
the preflight checks presence without decrypting, and only the Lambda execution
roles decrypt secrets at runtime. `hnb659fds` is CDK's default bootstrap qualifier
— change it only if you bootstrapped with a custom `--qualifier`. AWS validates
GitHub's cert against its own trust store, so the thumbprint value is a formality
the API still requires. Finally set `AWS_DEPLOY_ROLE_ARN` (step 4).

## Verify prerequisites (preflight)

Before deploying, confirm the four out-of-band items for a stage are actually in
place. The preflight checks that both SSM SecureStrings exist (presence only — it
does not decrypt them) and that `GOOGLE_CLIENT_ID_<STAGE>` is set — the same names
the stack reads at synth/runtime — so a missing or mis-pathed secret is caught
before it ships as broken Lambda config.

Run it with AWS credentials for the target account and the client id in the env
(this is the same check the deploy CI runs before `cdk deploy`):

```sh
GOOGLE_CLIENT_ID_STAGING=<staging-oauth-client-id> \
  npm run cli -- infra preflight --stage staging
```

Exit code 0 = ready; 2 = a prerequisite is missing (it lists which). Add
`--output json` for machine-readable output.

## First deploy

Run the preflight above first, then:

```sh
cd infra && npm ci
CDK_DEFAULT_ACCOUNT=859998284061 CDK_DEFAULT_REGION=us-east-1 \
  npx cdk deploy SeoApiStack-staging
```

## Migration note

The pre-split single `SeoApiStack` (if it was ever deployed) is superseded by
these two. After confirming staging is healthy, remove the old stack manually:
`npx cdk deploy` will not delete it because it is no longer in `bin/app.ts`.
Run `aws cloudformation delete-stack --stack-name SeoApiStack` once you are sure
nothing depends on it.
