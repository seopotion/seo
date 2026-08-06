# Frontend hosting on AWS via OpenNext — design

**Date:** 2026-08-06
**Issue:** [#35](https://github.com/seopotion/seo/issues/35) (sub-project C of the three-tier environment effort)
**Status:** APPROVED — supersedes the deleted `2026-07-04-frontend-hosting-previews-design.md` (removed at `57f7c12`)

## Context & goal

`apps/web` is live in production **on Vercel** at `www.seopotion.co` today; the goal is to move
it entirely to AWS. The app is pre-launch, so no zero-downtime choreography is required.

What the app actually needs from a host (settled in the #35 thread by code inspection):

- **No per-request SSR.** The public tree (`/`, `/pricing`, `/docs/*` × en/tr) is fully
  prerendered (SSG); no public page touches the API.
- **middleware** — hard requirement: `proxy.ts` (Next 16 name for middleware) runs next-intl
  locale routing (`localePrefix: 'as-needed'`).
- **`next/image`** — hard requirement: local-only images, including both LCP hero images on the
  SEO-critical landing page.
- **~2 dynamic routes** — the GSC and GitHub OAuth callback layouts set `force-dynamic` (to
  avoid a `useSearchParams` Suspense flash), so a server render path must exist.
- **Zero** route handlers, **zero** server actions, **zero** server-side API calls. The cookie
  auth migration (#18) is **out of scope**.

Budget constraint (owner): no paid platforms (Vercel etc.); ~$0 now, a few $/month later is
acceptable.

## Decision

**OpenNext (`@opennextjs/aws` v4.x) built output, deployed by a hand-rolled CDK stack**
(CloudFront + Lambda + S3), staging + prod, in the existing `infra/` package.

Rejected alternatives (researched 2026-08-06):

| Option | Why rejected |
| --- | --- |
| EC2 t4g.small + CloudFront | The "free" box is the t4g free trial ending **2026-12-31**; then ~$17.5/mo (instance + EBS + IPv4) — the most expensive option — plus real ops burden (patching, deploys, SPOF). |
| Cloudflare Workers (`@opennextjs/cloudflare`) | Genuinely $0, but a second platform outside our AWS/CDK/OIDC machinery; `next/image` needs extra wiring; Next 16 support has repeatedly lagged. |
| Static export + S3 + CloudFront Function | Drops middleware and image optimization — hand-rolled locale routing and an LCP regression exactly where SEO matters. |
| Amplify Hosting | No Next 16 support (docs: "through 15"); already rejected in the issue. |
| CDK construct libraries | jetbridge `cdk-nextjs-standalone` pins OpenNext 3.x, maintenance slowing; `cdklabs/cdk-nextjs` is experimental, not OpenNext (Build Adapters API), needs Docker. Hand-rolled CDK over `.open-next/` output is explicitly supported by OpenNext docs and fits our plain-CDK infra. |

Serverless economics: Lambda (1M req + 400K GB-s/mo) and CloudFront (1 TB + 10M req/mo) are
**always-free with no expiry** on all AWS account types post-2025 free-tier overhaul. At current
traffic the frontend rounds to **$0–1/month indefinitely** (S3 storage + CloudWatch logs bill
cents; S3 has no always-free tier anymore).

## Architecture

`npx @opennextjs/aws build` (run in CI) produces `.open-next/`; a new CDK stack deploys it:

- **S3 bucket** (+ Origin Access Control): prerendered HTML, `_next/static`, `public/` assets
  (including the gitignored WP-plugin zip built by `prebuild`).
- **Server Lambda** (Function URL origin): runs `proxy.ts` and the 2 OAuth callback routes.
- **Image Lambda**: `next/image`/sharp, behind the `/_next/image*` behavior.
- **CloudFront distribution**: static/asset behaviors → S3; `/_next/image*` → image fn;
  default → server fn. Prod additionally gets a CloudFront Function redirecting apex → www.
- **ISR machinery, provisioned but idle**: FIFO revalidation queue + DynamoDB tag-cache table,
  so a future `/blog` with `revalidate` is a page-level change, not an infra migration
  (explicit ask from the frontend dev). Idle cost ≈ pennies.

Stacks: `SeoWebStack-staging` and `SeoWebStack-prod` (termination-protected), instantiated in
`infra/bin/app.ts` beside the ApiStacks. Same account (859998284061) / region (us-east-1 —
also where CloudFront requires ACM certs). New `infra/lib/web-stack.ts`; per-stage values
extend `infra/lib/config.ts` `STAGE_CONFIG`.

## Prerequisites

- **Bump `next` to ≥ 16.2.11** (lockfile currently resolves 16.2.9; `@opennextjs/aws@4.1.0`
  peer dep floor is `>=16.2.11`). Gotcha: the macOS npm `@emnapi` lockfile-prune trap — check
  the lockfile diff before committing.
- **Production builds must use webpack**: change the `apps/web` `build` script to
  `next build --webpack` — Turbopack builds hit opennextjs-aws bug
  [#1175](https://github.com/opennextjs/opennextjs-aws/issues/1175)
  (missing 404/error chunks → runtime 500s). `next dev` stays on Turbopack.
- `apps/web/open-next.config.ts` with `buildCommand: 'npm run build'` so the `prebuild`
  WP-plugin zip step keeps running (needs `zip` CLI + full monorepo checkout — both true on
  `ubuntu-latest`).

## Domains & DNS

**Cloudflare stays** as registrar + DNS host (decided 2026-08-06). The domain is registered
with Cloudflare Registrar, which mandates Cloudflare nameservers — moving DNS to Route 53
would require a registrar transfer, deliberately not part of this issue.

- **Prod:** `www.seopotion.co` canonical (matches what is live/indexed today); apex
  `seopotion.co` 301s to www via CloudFront Function. One ACM cert covering both names.
- **Staging:** `staging.seopotion.co`, own ACM cert, noindex enforced (below).
- ACM DNS validation = **one-time manual CNAMEs in Cloudflare** (per cert); renewals are then
  automatic forever. Note: without a hosted zone, the first `cdk deploy` of each web stack
  **pauses** at the certificate resource until the validation CNAME is added in Cloudflare
  (values appear in the ACM console during the deploy) — expected, not a hang. All records DNS-only (grey cloud) CNAMEs to the CloudFront domains;
  Cloudflare's apex CNAME flattening covers the root.
- The web stack accepts an **optional Route 53 hosted zone** parameter (unused today): if the
  domain ever transfers, cert validation + alias records become CDK-managed via config, not a
  redesign.
- **Cutover:** deploy → verify on the generated CloudFront URL → flip Cloudflare records →
  retire the Vercel project (manual, owner-side).

## App changes (deliberately minimal)

- `app/robots.ts`: return disallow-all when a new `NEXT_PUBLIC_NOINDEX` build flag is set
  (staging builds set it; prod builds don't).
- No other app code changes. Per-env values are supplied at build time by CI:
  `NEXT_PUBLIC_API_URL` (new stage-suffixed GitHub repo variables, matching the existing
  `WEB_ORIGIN_*` convention), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
  (reuses existing `GOOGLE_CLIENT_ID_<STAGE>` variables).

## CI/CD

New `.github/workflows/deploy-frontend.yml` mirroring `deploy-backend.yml`'s shape and guards:

- **deploy-staging:** push to `master`, path filters (`apps/web/**`, `packages/**`,
  `apps/integration-clients/wordpress-org/**`, `scripts/package-wp-plugin.mjs`, the web-stack
  infra files, the workflow itself). Steps: checkout → root `npm ci` → `npx @opennextjs/aws build`
  with staging `NEXT_PUBLIC_*` env → `cd infra && npm ci && npx cdk deploy SeoWebStack-staging`.
- **deploy-prod:** release published (prereleases excluded) → same release-SHA-is-on-master
  ancestry check and successful-staging-run check (against *this* workflow) → deploy
  `SeoWebStack-prod` with prod env.
- **Reuses the existing `github-actions-seo-deploy` OIDC role unchanged** — its trust policy
  already admits exactly these two subjects (`refs/heads/master`, `environment:prod`).
- Concurrency groups per stage, `cancel-in-progress: false`, like the backend.

## Manual steps (owner)

1. Add the two ACM validation CNAMEs + `www`/apex/`staging` CNAMEs in Cloudflare (values come
   from stack outputs; one-time).
2. Register `https://staging.seopotion.co` as an authorized JavaScript origin in the Google
   OAuth console (`www.seopotion.co` is already registered).
3. Set new repo variables (`NEXT_PUBLIC_API_URL_STAGING/PROD` etc.); update
   `WEB_ORIGIN_STAGING/PROD` to the new origins and redeploy the backend once (CORS + GSC
   redirect base).
4. After verification: flip DNS, then retire the Vercel project.

## Verification

Staging smoke, before any prod DNS flip:

- Locale routing: `/` serves en, `/tr` serves tr, `as-needed` prefixes behave (no `/en` prefix).
- `/_next/image?url=…` returns resized/modern-format output (image Lambda works).
- Docs MDX pages render; `robots.txt` disallows all on staging; `sitemap.xml` and canonicals
  point at the staging host, not prod.
- Google login end-to-end; both OAuth callback routes render without error.
- 404 and error pages work (this is exactly what the Turbopack bug breaks — regression-check it).

Prod after DNS flip: same checks against `www.seopotion.co`, plus apex → www redirect.

## Out of scope (deferred, not rejected)

- Shared preview env tracking `dev` (needs an OIDC trust-policy addition; fast follow).
- Per-PR previews; cookie-auth migration (#18); actual ISR usage (`/blog`); warmer Lambda; WAF;
  Route 53 registrar transfer.

## Cost summary

~**$0–1/month indefinitely** (always-free Lambda/CloudFront absorb the traffic; cents for S3 +
logs; short log retention set on all new Lambdas). No dependence on the t4g.small trial ending
2026-12-31. ACM certs free. No Route 53 zone needed.
