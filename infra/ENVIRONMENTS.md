# Backend environments

**Each stage lives in its own AWS account**, inside the `clewas` organization
(`o-snqpg05rx9`). How the accounts and human access were set up is a separate
document — [`ACCOUNT-SETUP.md`](ACCOUNT-SETUP.md).

| Stage | Account | ID | Deployed by |
| ----- | ------- | -- | ----------- |
| staging | `seo-staging` | `977476318001` | merge `dev` → `master` |
| prod | `seo-prod` | `672093561569` | publishing a GitHub Release |
| — | `clewas` (management) | `849445096310` | billing + identity only, no workloads |

Pushes to `dev` deploy nothing. Prod carries `terminationProtection: true` — see
[Deploying prod](#deploying-prod).

Because the stages are in different accounts, `AWS_ACCOUNT_ID` and
`AWS_DEPLOY_ROLE_ARN` are **GitHub _environment_ secrets**, not repo-level ones —
each of the `staging` / `prod` environments carries its own pair. Each account
has its own OIDC provider and `github-actions-seo-deploy` role, whose trust
policy is scoped to that environment's subject
(`repo:seopotion/seo:environment:<stage>`).

Current endpoints:

| | staging | prod |
| --- | --- | --- |
| API | `https://jc55q74rd2.execute-api.us-east-1.amazonaws.com` | `https://etcsla3cub.execute-api.us-east-1.amazonaws.com` |
| Admin API | `https://s0plnqjsa4.execute-api.us-east-1.amazonaws.com` | `https://hob5t9w1i7.execute-api.us-east-1.amazonaws.com` |
| Web | `staging.seopotion.co` | `www.seopotion.co` (apex 301s to www) |
| Images CDN | `d1j2qr4p4hoxbs.cloudfront.net` | `d1aklxjf6zd9yy.cloudfront.net` |

Config lives in `infra/lib/config.ts` (non-secret values + SSM parameter NAMES).
Secret values are provisioned out-of-band and resolved at Lambda runtime. The
SSM parameter *names* are identical in both accounts (`/seo/<stage>/…`); isolation
comes from the account boundary, not the path.

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
   gh variable set WEB_ORIGIN_STAGING --repo seopotion/seo --body 'https://staging.seopotion.co'
   gh variable set WEB_ORIGIN_PROD    --repo seopotion/seo --body 'https://www.seopotion.co'
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
   sets it per checkout to `<WEB_ORIGIN>/billing?checkout=success&tier=<tier>`, so it is
   stage-aware automatically.

4. **GitHub OIDC provider + deploy role**, per account — see [GitHub OIDC deploy
   role](#github-oidc-deploy-role) below. Store its ARN and the account id as
   **environment** secrets, scoped to the matching stage. Repo-level secrets are
   deliberately absent: one value cannot serve two accounts, and a repo-level
   fallback silently pointing at the wrong account is exactly the failure this
   avoids.

   ```sh
   gh secret set AWS_ACCOUNT_ID      --env staging --body '977476318001'
   gh secret set AWS_DEPLOY_ROLE_ARN --env staging --body 'arn:aws:iam::977476318001:role/github-actions-seo-deploy'
   gh secret set AWS_ACCOUNT_ID      --env prod    --body '672093561569'
   gh secret set AWS_DEPLOY_ROLE_ARN --env prod    --body 'arn:aws:iam::672093561569:role/github-actions-seo-deploy'
   ```

   Both deploy jobs declare `environment:`, so every job resolving these secrets
   gets its own stage's values.

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
| Authorized JS origins        | `http://localhost:3000`, `https://staging.seopotion.co` |
| Authorized redirect URIs     | `http://localhost:3000/dashboard/gsc/callback`, `https://staging.seopotion.co/dashboard/gsc/callback` |

- Origins are `scheme://host[:port]` — **no trailing slash, no path**; HTTPS
  except `localhost`. Add the generated CloudFront origin once the frontend
  sub-project (C) deploys staging — origins are editable without recreating the
  client. Prod mirrors this with `www.seopotion.co`.
- If the **OAuth consent screen** is in *Testing* mode, only listed test users
  can sign in — add your test accounts or publish the app.
- The same client id is also the frontend's `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (#21).
- The client's **secret** (needed for the GSC code exchange) is stored in SSM as
  `google-client-secret` — see [prerequisites](#one-time-prerequisites-per-account)
  above.

## GitHub OIDC deploy role

**Once per account.** Run it against `seo-staging` and `seo-prod` separately,
substituting `$ACCOUNT` and `$STAGE` — the two roles are independent and neither
can deploy the other's stage.

```sh
# staging: ACCOUNT=977476318001 STAGE=staging PROFILE=seo-staging
# prod:    ACCOUNT=672093561569 STAGE=prod    PROFILE=seo-prod
export ACCOUNT=977476318001 STAGE=staging AWS_PROFILE=seo-staging

cd infra && npx cdk bootstrap "aws://$ACCOUNT/us-east-1"

# Only one provider per URL per account — skip if `aws iam list-open-id-connect-providers` shows it:
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 1c58a3a8518e8759bf075b76b750d4f2df264fca

cat > /tmp/trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:seopotion/seo:environment:$STAGE"
      }
    }
  }]
}
JSON

cat > /tmp/perms.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::$ACCOUNT:role/cdk-hnb659fds-*"
    },
    {
      "Sid": "PreflightReadSsm",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:us-east-1:$ACCOUNT:parameter/seo/*"
    }
  ]
}
JSON

aws iam create-role --role-name github-actions-seo-deploy \
  --assume-role-policy-document file:///tmp/trust.json
aws iam put-role-policy --role-name github-actions-seo-deploy \
  --policy-name cdk-deploy --policy-document file:///tmp/perms.json
```

The frontend workflow needs two further grants on the same role — see
[Deploy-role policy addition](#deploy-role-policy-addition).

The trust condition uses `StringEquals` on a single `environment:` subject, not
`StringLike` over branch refs. Both deploy jobs declare an `environment`, so the
OIDC token's subject is always `repo:seopotion/seo:environment:<stage>` — a
branch-based subject would no longer match, and each role trusts exactly one
stage.

This is also why prod deploys used to fail before they reached AWS: the role
trusted only `refs/heads/*` subjects, while the prod job's `environment: prod`
produced `repo:seopotion/seo:environment:prod`, which matched nothing.

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
AWS_PROFILE=seo-staging CDK_DEFAULT_ACCOUNT=977476318001 CDK_DEFAULT_REGION=us-east-1 \
  npx cdk deploy SeoApiStack-staging
```

For prod, swap the profile/account (`seo-prod` / `672093561569`) and the stack
name. **Deploy from `master`, not a feature branch** — `cdk deploy` ships
whatever is checked out, with no relationship to what staging validated. The
Release flow below exists precisely to make that impossible.

## Deploying prod

Prod ships from a **GitHub Release**, never from a branch push. The
`deploy-prod` job in `.github/workflows/deploy-backend.yml` runs on
`release: published` and, before it holds any AWS credentials, asserts two
things about the released commit:

1. it is an ancestor of `master`, and
2. this workflow has a **successful `push` run for that exact commit** — i.e.
   staging really deployed it.

Being on `master` is not by itself evidence of a staging deploy: the run could
have failed or been cancelled, and a `master` commit that touches none of the
workflow's path filters never triggers a run at all. So a release must point at
a `master` commit whose staging deploy actually succeeded — otherwise the job
fails before reaching AWS. Prereleases are ignored.

**There is no approval step.** Publishing the Release *is* the gate: the job
deploys straight through. Required-reviewer rules on an environment need a paid
plan for private repos, and this org's plan rejects them — so the `prod`
environment exists with no protection rules. It is still declared in the
workflow, because it is what makes the OIDC token's subject
`repo:seopotion/seo:environment:prod`. Treat publishing a Release as an
irreversible action.

One-time setup, in addition to the prerequisites above:

1. **The `prod` GitHub Environment exists** (created 2026-08-04, no rules). If
   the plan is ever upgraded, add a required reviewer at
   `Settings → Environments → prod → Required reviewers` — the workflow needs no
   change to start honouring it.
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

The deploy starts immediately — watch it in the Actions tab. The stack emits `HttpApiUrl` and
`AdminHttpApiUrl`; the LemonSqueezy prod webhook must be pointed at
`<HttpApiUrl>` after this first deploy, since the URL does not exist until then.

Prod carries `terminationProtection: true`, so `cdk destroy` / `delete-stack`
refuse until it is turned off deliberately.

## Migration note

Both stages previously ran in a single personal account, `859998284061`. That
account was emptied on 2026-08-12 and left dormant — it holds no stacks, buckets,
Lambdas, roles or SSM parameters, and nothing depends on it. The move is recorded
in [#203](https://github.com/seopotion/seo/issues/203).

Two consequences worth carrying forward:

- **Article images generated before the migration are gone.** `images[].url` and
  `featured_image_url` store an *absolute* URL built from `IMAGES_CDN_DOMAIN` at
  generation time, so staging records still point at the old account's CDN. Any
  future account move has the same property: moving the bucket does not move the
  URLs.
- **The old account is still its own organization's management account**, so it
  cannot be invited into `o-snqpg05rx9` until that organization is deleted.

# Frontend (SeoWebStack)

Two more stacks, each in the **same account as its stage's backend**, deployed by
`.github/workflows/deploy-frontend.yml` with the same triggers/guards as the
backend (push to `master` → staging; published Release → prod, gated on the
release commit being on `master` with its own successful staging run):

- `SeoWebStack-staging` — `https://staging.seopotion.co`
- `SeoWebStack-prod` — `https://www.seopotion.co`, with the apex
  `https://seopotion.co` 301-redirecting to `www` (query string preserved)

Each stack is Next.js on OpenNext: a CloudFront distribution in front of a
server-rendering Lambda (function URL), an image-optimization Lambda, an S3
asset bucket, and idle ISR machinery (revalidation queue + DynamoDB tag cache).
Staging serves a `robots.txt` disallow-all (`NEXT_PUBLIC_NOINDEX=1` baked in at
build time); prod does not set it.

## New repo variables

The `NEXT_PUBLIC_*` build args are inlined at build time (OpenNext build runs
once per stage in CI), so each stage needs its own set as GitHub Actions repo
**variables**:

- `NEXT_PUBLIC_API_URL_STAGING` / `NEXT_PUBLIC_API_URL_PROD` — the `HttpApiUrl`
  output of the corresponding `SeoApiStack-<stage>`.
- `WEB_ORIGIN_STAGING` / `WEB_ORIGIN_PROD` — already exist for the GSC OAuth
  redirect base (see [prerequisites](#one-time-prerequisites-per-account)
  above), but now **also** feed the web build's `NEXT_PUBLIC_SITE_URL` and must
  point at the real frontend hosts: `https://staging.seopotion.co` /
  `https://www.seopotion.co`. Changing them requires **one backend redeploy**
  per stage, since they're baked into the API Lambda at synth time to build
  the GSC OAuth redirect base.
- `GOOGLE_CLIENT_ID_STAGING` / `GOOGLE_CLIENT_ID_PROD` — already exist (see
  above); reused as-is for `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

## Deploy-role policy addition

One-time, needed because the workflow invokes the tag-seed Lambda and creates
CloudFront invalidations after each `cdk deploy`:

```sh
aws iam put-role-policy --role-name github-actions-seo-deploy \
  --policy-name frontend-deploy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      { "Effect": "Allow", "Action": "lambda:InvokeFunction",
        "Resource": "arn:aws:lambda:us-east-1:'"$AWS_ACCOUNT_ID"':function:SeoWebStack-*" },
      { "Effect": "Allow", "Action": "cloudfront:CreateInvalidation",
        "Resource": "arn:aws:cloudfront::'"$AWS_ACCOUNT_ID"':distribution/*" }
    ]
  }'
```

## First-deploy runbook

**Deploy `SeoWebStack-*` only via `deploy-frontend.yml` (CI), never `cdk deploy`
from a laptop.** `.open-next` bundles native dependencies for the target Lambda
architecture (`sharp`, used by the image-optimization function), and sharp's
installer honors the *host* platform, not the requested `linux/arm64` — a
macOS-built `.open-next` bakes in a darwin binary, so `/_next/image` would 500
in Lambda. CI runs on `ubuntu-latest` and produces correct linux binaries.

The first `cdk deploy` of each web stack **pauses** at the `WebCert`
certificate resource until the ACM validation CNAMEs are added in Cloudflare —
open the ACM console while the deploy is waiting, find the pending
certificate, and copy its validation CNAME name/value into Cloudflare as
**DNS-only** (grey-cloud) records. Once ACM validates, the deploy continues.

Then, once the stack finishes and emits `DistributionDomain`:

1. Add the site CNAMEs in Cloudflare — `staging`, `www`, and the apex
   (`seopotion.co`) — all **DNS-only** (grey-cloud), targeting the stack's
   `DistributionDomain` output. (Cloudflare flattens the apex CNAME
   automatically.)
2. Register `https://staging.seopotion.co` (and later `https://www.seopotion.co`)
   as an **Authorized JavaScript origin** on the matching Google OAuth client
   — see [Google OAuth clients](#google-oauth-clients) above.

## Cutover checklist

Staging first, full smoke against `https://staging.seopotion.co`:

- Locale routing (`en`/`tr`)
- `_next/image` resizing
- Docs MDX pages render
- `robots.txt` disallow-all
- Sitemap/canonical URLs point at the staging host
- Google login + both OAuth callbacks (login, GSC)
- 404 / error pages

Then flip the prod DNS records (see [First-deploy runbook](#first-deploy-runbook)) and re-run the same
checks against `https://www.seopotion.co`, plus the apex redirect
(`https://seopotion.co` → `https://www.seopotion.co`, query string preserved).
Once prod is verified, delete the Vercel project.
