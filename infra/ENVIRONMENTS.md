# Backend environments

Two stacks, one AWS account (`personal` / 859998284061 / us-east-1):

- `SeoApiStack-staging` — deployed on merge `dev` → `master`. (Pushes to `dev` deploy nothing.)
- `SeoApiStack-prod` — deployed by publishing a GitHub Release, gated by the `prod`
  GitHub Environment. Termination protection is on. See [Deploying prod](#deploying-prod).

Config lives in `infra/lib/config.ts` (non-secret values + SSM parameter NAMES).
Secret values are provisioned out-of-band and resolved at Lambda runtime.

## One-time prerequisites (per account)

1. **Two Atlas clusters** (staging, prod) → two connection strings.
2. **SSM SecureStrings** (values never enter CloudFormation). Generate each
   JWT secret and GSC token key with `openssl rand -base64 32`:

   ```sh
   aws ssm put-parameter --name /seo/staging/mongo-uri  --type SecureString --value '<staging-conn-str>'
   aws ssm put-parameter --name /seo/staging/jwt-secret --type SecureString --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --name /seo/prod/mongo-uri     --type SecureString --value '<prod-conn-str>'
   aws ssm put-parameter --name /seo/prod/jwt-secret    --type SecureString --value "$(openssl rand -base64 32)"
   ```

   GSC integration (#12) needs two more SecureStrings per stage: the Google
   OAuth client's **client secret** (paired with `GOOGLE_CLIENT_ID_<STAGE>`
   below — used to exchange the GSC OAuth code server-side) and a symmetric
   **token key** used to encrypt stored GSC refresh tokens at rest:

   ```sh
   aws ssm put-parameter --name /seo/staging/google-client-secret --type SecureString --value '<staging-oauth-client-secret>'
   aws ssm put-parameter --name /seo/staging/gsc-token-key        --type SecureString --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --name /seo/prod/google-client-secret    --type SecureString --value '<prod-oauth-client-secret>'
   aws ssm put-parameter --name /seo/prod/gsc-token-key           --type SecureString --value "$(openssl rand -base64 32)"
   ```

   Billing (#13) needs two more SecureStrings per stage: the LemonSqueezy
   **API key** (used server-side for checkout/portal calls) and the
   **webhook signing secret** (used to verify incoming LemonSqueezy webhooks):

   ```sh
   aws ssm put-parameter --name /seo/staging/lemonsqueezy-api-key         --type SecureString --value '<ls_api_key>'
   aws ssm put-parameter --name /seo/staging/lemonsqueezy-webhook-secret  --type SecureString --value '<ls_webhook_secret>'
   aws ssm put-parameter --name /seo/prod/lemonsqueezy-api-key            --type SecureString --value '<ls_api_key>'
   aws ssm put-parameter --name /seo/prod/lemonsqueezy-webhook-secret     --type SecureString --value '<ls_webhook_secret>'
   ```

   The admin panel (#150) needs two more per stage: its **own** HS256 signing
   secret (granted to the admin Lambda alone — never the customer one) and the
   **operator allowlist**, a *plain String* of comma-separated emails. The
   allowlist is re-read every ~5 min at runtime, so editing it takes effect
   without a redeploy; the signing secret rotates only by redeploy.

   ```sh
   aws ssm put-parameter --name /seo/staging/admin/jwt-secret --type SecureString --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --name /seo/staging/admin/operators  --type String       --value 'a@x.com,b@y.com'
   aws ssm put-parameter --name /seo/prod/admin/jwt-secret    --type SecureString --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --name /seo/prod/admin/operators     --type String       --value 'a@x.com,b@y.com'
   ```

   The **provider API credentials** (#43) are five more SecureStrings per stage.
   These used to be GitHub Actions secrets baked into the Lambda environment at
   synth time — shared across both stages and visible in the CloudFormation
   template. They are now resolved at runtime like everything else, so **each
   stage needs its own set before its next deploy** (a missing one deploys a
   worker that calls its provider with an empty key):

   ```sh
   aws ssm put-parameter --name /seo/staging/dataforseo-login    --type SecureString --value '<df_login>'
   aws ssm put-parameter --name /seo/staging/dataforseo-password --type SecureString --value '<df_password>'
   aws ssm put-parameter --name /seo/staging/openrouter-api-key  --type SecureString --value '<or_key>'
   aws ssm put-parameter --name /seo/staging/youtube-api-key     --type SecureString --value '<yt_key>'
   aws ssm put-parameter --name /seo/staging/fal-key             --type SecureString --value '<fal_key>'
   aws ssm put-parameter --name /seo/prod/dataforseo-login       --type SecureString --value '<df_login>'
   aws ssm put-parameter --name /seo/prod/dataforseo-password    --type SecureString --value '<df_password>'
   aws ssm put-parameter --name /seo/prod/openrouter-api-key     --type SecureString --value '<or_key>'
   aws ssm put-parameter --name /seo/prod/youtube-api-key        --type SecureString --value '<yt_key>'
   aws ssm put-parameter --name /seo/prod/fal-key                --type SecureString --value '<fal_key>'
   ```

   Each Lambda is granted only the keys it calls: DataForSEO to the api, admin,
   scan and strategy functions; OpenRouter to the four workers; YouTube to the
   generation worker; fal to the images worker. The scheduler and db-init get
   none. Local dev is unaffected — with no `*_PARAM` set, the plain
   `DATAFORSEO_LOGIN` / `OPENROUTER_API_KEY` / … vars in the root `.env` are used.

3. **Two Google OAuth client IDs** (staging vs prod) — see [Google OAuth
   clients](#google-oauth-clients) below. Set each as a GitHub Actions repo
   **variable** `GOOGLE_CLIENT_ID_STAGING` / `GOOGLE_CLIENT_ID_PROD` (public, not
   secrets):

   ```sh
   gh variable set GOOGLE_CLIENT_ID_STAGING --repo seopotion/seo --body '<staging-client-id>'
   gh variable set GOOGLE_CLIENT_ID_PROD    --repo seopotion/seo --body '<prod-client-id>'
   ```

   GSC integration (#12) also needs the web app's origin per stage — it's the
   base of the GSC OAuth redirect URI, baked into the Lambda env at synth time
   (`infra/lib/config.ts`'s `webOrigin`; an unset var silently falls back to an
   empty string, which bakes a broken redirect URI into the Lambda). Set
   `WEB_ORIGIN_STAGING` / `WEB_ORIGIN_PROD` as GitHub Actions repo variables
   the same way:

   ```sh
   gh variable set WEB_ORIGIN_STAGING --repo seopotion/seo --body 'https://app-staging.seopotion.co'
   gh variable set WEB_ORIGIN_PROD    --repo seopotion/seo --body 'https://app.seopotion.co'
   ```

   The resulting `<web origin>/dashboard/gsc/callback` redirect URI must also
   be registered as an **Authorized redirect URI** on the same stage's Google
   OAuth client (see [Google OAuth clients](#google-oauth-clients) below).

   Billing (#13) also needs three public LemonSqueezy values per stage — the
   store id and the two subscription variant ids (paid, expert) — baked into
   the Lambda env at synth time (`infra/lib/config.ts`'s `lemonSqueezyStoreId`
   / `lemonSqueezyVariantPaid` / `lemonSqueezyVariantExpert`; an unset var
   silently falls back to an empty string). Set them as GitHub Actions repo
   variables the same way:

   ```sh
   gh variable set LEMONSQUEEZY_STORE_ID_STAGING      --repo seopotion/seo --body '<staging-store-id>'
   gh variable set LEMONSQUEEZY_VARIANT_PAID_STAGING  --repo seopotion/seo --body '<staging-paid-variant-id>'
   gh variable set LEMONSQUEEZY_VARIANT_EXPERT_STAGING --repo seopotion/seo --body '<staging-expert-variant-id>'
   gh variable set LEMONSQUEEZY_STORE_ID_PROD         --repo seopotion/seo --body '<prod-store-id>'
   gh variable set LEMONSQUEEZY_VARIANT_PAID_PROD     --repo seopotion/seo --body '<prod-paid-variant-id>'
   gh variable set LEMONSQUEEZY_VARIANT_EXPERT_PROD    --repo seopotion/seo --body '<prod-expert-variant-id>'
   ```

   The post-checkout redirect URL needs no store-level configuration: the API
   sets it per checkout to `<WEB_ORIGIN>/billing?checkout=success`, so it is
   stage-aware automatically.

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
JavaScript origins** for that flow (it never redirects). GSC integration (#12)
reuses the same client for a server-side **authorization-code** flow, which
does redirect — so it also needs an **Authorized redirect URI** of
`<web origin>/dashboard/gsc/callback`. Create one **Web application** client
per environment (`console.cloud.google.com` → APIs & Services → Credentials):

| Field                        | Staging                                            |
| ---------------------------- | -------------------------------------------------- |
| Name (internal)              | `SEO Potion — staging (web)`                        |
| Authorized JS origins        | `http://localhost:3000`, `https://app-staging.seopotion.co` |
| Authorized redirect URIs     | `http://localhost:3000/dashboard/gsc/callback`, `https://app-staging.seopotion.co/dashboard/gsc/callback` |

- Origins are `scheme://host[:port]` — **no trailing slash, no path**; HTTPS
  except `localhost`. Add the generated CloudFront origin once the frontend
  sub-project (C) deploys staging — origins are editable without recreating the
  client. Prod mirrors this with `app.seopotion.co`.
- If the **OAuth consent screen** is in *Testing* mode, only listed test users
  can sign in — add your test accounts or publish the app.
- The same client id is also the frontend's `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (#21).
- The client's **secret** (needed for the GSC code exchange) is stored in SSM as
  `google-client-secret` — see [prerequisites](#one-time-prerequisites-per-account)
  above.

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
        "repo:seopotion/seo:ref:refs/heads/master",
        "repo:seopotion/seo:environment:prod"
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

Before deploying, confirm the out-of-band items for a stage are actually in
place. The preflight checks that all twelve SSM SecureStrings exist (jwt-secret,
mongo-uri, google-client-secret, gsc-token-key, lemonsqueezy-api-key,
lemonsqueezy-webhook-secret, admin/jwt-secret, and the five provider
credentials — presence only, it does not
decrypt them), that the plain-String `admin/operators` allowlist exists, and
that `GOOGLE_CLIENT_ID_<STAGE>`, `WEB_ORIGIN_<STAGE>`,
`LEMONSQUEEZY_STORE_ID_<STAGE>`, `LEMONSQUEEZY_VARIANT_PAID_<STAGE>`, and
`LEMONSQUEEZY_VARIANT_EXPERT_<STAGE>` are set — the same names the stack reads
at synth/runtime — so a missing or mis-pathed prerequisite is caught before it
ships as broken Lambda config.

Run it with AWS credentials for the target account and both env vars set
(this is the same check the deploy CI runs before `cdk deploy`):

```sh
GOOGLE_CLIENT_ID_STAGING=<staging-oauth-client-id> \
WEB_ORIGIN_STAGING=<staging-web-origin> \
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

## Deploying prod

Prod ships from a **GitHub Release**, never from a branch push. The
`deploy-prod` job in `.github/workflows/deploy-backend.yml` runs on
`release: published` and, before it holds any AWS credentials, asserts the
released commit is an ancestor of `master` — so prod can only ship code staging
has already run. Prereleases are ignored.

One-time setup, in addition to the prerequisites above:

1. **Create the `prod` GitHub Environment** with a required reviewer — this is
   the human gate; the job waits on it before deploying:
   `Settings → Environments → New environment → prod → Required reviewers`.
   (Referencing it in the workflow creates it *without* protection rules, so
   adding the reviewer by hand is what actually gates anything.)
2. **Add the `environment:prod` subject to the deploy role's trust policy** — a
   release run's OIDC token is subject `repo:seopotion/seo:environment:prod`,
   not a `refs/heads/*` one, so without this the job fails at
   `configure-aws-credentials` before doing anything else. See
   [GitHub OIDC deploy role](#github-oidc-deploy-role) above.

To ship:

```sh
git tag v0.1.0 <commit-on-master> && git push origin v0.1.0
gh release create v0.1.0 --title v0.1.0 --notes 'first prod deploy'
```

Then approve the run in the Actions tab. The stack emits `HttpApiUrl` and
`AdminHttpApiUrl`; the LemonSqueezy prod webhook must be pointed at
`<HttpApiUrl>` after this first deploy, since the URL does not exist until then.

Prod carries `terminationProtection: true`, so `cdk destroy` / `delete-stack`
refuse until it is turned off deliberately.

## Migration note

The pre-split single `SeoApiStack` (if it was ever deployed) is superseded by
these two. After confirming staging is healthy, remove the old stack manually:
`npx cdk deploy` will not delete it because it is no longer in `bin/app.ts`.
Run `aws cloudformation delete-stack --stack-name SeoApiStack` once you are sure
nothing depends on it.
