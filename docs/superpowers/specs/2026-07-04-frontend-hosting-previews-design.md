# Frontend hosting + previews (sub-project C) — design

_Date: 2026-07-04_

> **STATUS: STUB — partially blocked.** The hosting target (OpenNext + CDK) is locked.
> The **SSR scope** and the **auth model** are open pending answers from the frontend dev
> (see [Open questions](#open-questions-blocking)). Sections that depend on those answers
> are marked _TBD_. Do not start implementation until the blocking questions are resolved.

## Context

This is **sub-project C** of the three-tier environment effort (preview → staging → prod).
The decomposition (see [`2026-07-03-backend-environments-design.md`](2026-07-03-backend-environments-design.md)):

- **A. Backend environments** — two CDK `ApiStack`s (staging + prod), per-env secrets.
  Designed + planned; the foundation this depends on for API URLs.
- **B. Wishlist → Hono API** — relocate the one Next.js route handler
  (`apps/web/app/api/wishlist/route.ts`) off Supabase. **Re-scoped by the SSR decision** —
  see [§ Impact on sub-project B](#impact-on-sub-project-b).
- **C. Frontend hosting + previews (this spec)** — deploy `apps/web` to AWS for prod
  (`app.`), staging (`app-staging.`), and per-PR previews (`*.preview.`), on an independent
  CI pipeline.

### What changed since the A/B/C decomposition

The original decomposition assumed the frontend would be a **pure static export to
S3 + CloudFront**. The frontend dev has since said **SSR is required**. Two findings reframe
this spec:

1. **`apps/web` is already a standard Next.js server build.** `apps/web/next.config.mjs` has
   **no `output: 'export'`** — SSR/ISR/server-components work today. The static-export was a
   *planned future change that was never applied*. So this sub-project must **host a running
   Next server**, not "add SSR." The "static export → S3" design is dropped.
2. **Auth is currently invisible to the server.** `apps/web/lib/auth.ts` stores the session
   JWT in `localStorage`, which SSR cannot read. SSR of **authenticated** pages therefore
   renders logged-out then hydrates — no SSR benefit for the dashboard — unless the token
   moves to an **httpOnly cookie** set by the Hono API. This also closes the XSS gap noted
   in `lib/auth.ts` / issue [#18](https://github.com/seopotion/seo/issues/18).

## Environment / branch model (unchanged from A)

| Tier    | Trigger                   | Frontend host                      |
| ------- | ------------------------- | ---------------------------------- |
| Preview | PR into `dev`             | per-PR `*.preview.` (uses staging API) |
| Staging | merge to `dev`            | `app-staging.`                     |
| Prod    | merge/release to `master` | `app.`                             |

Backend and frontend deploy on **independent CI pipelines** — a frontend change never waits
on a backend release. Each tier's frontend build points at the matching backend's
`HttpApiUrl` (`CfnOutput` from sub-project A) as `NEXT_PUBLIC_API_URL`.

## Decisions (locked)

- **Hosting: OpenNext + CDK** (CloudFront + Lambda + S3 via the `open-next` adapter).
  Chosen over Amplify Hosting and containers because it fits the existing CDK / CloudFront /
  per-PR-preview plan, scales to zero, preserves the independent-CI decoupling, and keeps
  server-side calls to the Hono API possible. Rejected: **Amplify** (different deploy model
  from our CDK stacks, less preview control); **App Runner/Fargate** (always-on cost, no
  free per-PR previews).
- **Single AWS account** (`personal` / 859998284061 / us-east-1), consistent with A.
- **Generated CloudFront domains initially**; custom domains (`app.` / `app-staging.`) and
  per-PR preview subdomains are wired once DNS is decided — **defer** custom-domain setup,
  same YAGNI stance as A's API domains.
- **Independent backend/frontend CI** — a new frontend deploy workflow, separate from
  A's `deploy-backend.yml`.

## Open questions (blocking)

These come from the frontend dev and each gates a design section. Resolve before writing the
plan.

1. **Which pages need server rendering?** Splits into logged-out (works today) vs the authed
   dashboard (needs Q2).
2. **Does the authed dashboard need SSR?** If yes → **cookie-auth migration is in scope**
   (a `/core/login` backend change + client rework). If no (public content only, dashboard
   stays client-rendered) → **no auth change**, cheapest path.
3. **SSR vs ISR?** Per-request dynamic, or per-build/periodic revalidation? For an SEO
   product, crawlable content is often **ISR**, which is cheaper/simpler on OpenNext.
4. **Which Next server features?** middleware, `next/image` optimization, route handlers,
   server actions — changes what OpenNext wires up and whether the wishlist route handler
   stays in Next (see B).
5. **Are per-PR previews still a hard requirement?** Assumed yes; confirm.

## Design

### 1. OpenNext build + CDK construct — _partially TBD_

`apps/web` builds via OpenNext into the server function + static assets + cache artifacts.
A CDK construct (candidate: `open-next` reference construct or cdklabs `aws-cdk-nextjs`)
wires CloudFront → Lambda (SSR) + S3 (static/ISR cache). Whether we author the construct in
the existing standalone `infra/` package or a sibling package is _TBD_ (depends on keeping
frontend/backend CI independent — likely a separate stack, same repo).

- **SSR vs ISR cache wiring** — _TBD, gated on open question 3._
- **`next/image` / middleware** — _TBD, gated on open question 4._

### 2. Per-tier config — _TBD_

Mirror A's per-stage pattern: staging/prod frontend stacks, each with
`NEXT_PUBLIC_API_URL` = the matching backend `HttpApiUrl`, plus
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` per env (issue [#21](https://github.com/seopotion/seo/issues/21)).
Preview builds point at the **staging** API.

### 3. Auth model — _TBD, gated on open question 2_

If the dashboard must be SSR:

- `/core/login` sets an **httpOnly, Secure, SameSite** cookie carrying the session JWT
  (in addition to or instead of the JSON body). Backend change — coordinate with
  sub-project A's `apps/api` (a task may spill back there).
- `apps/web/lib/auth.ts` reads the token server-side via `next/headers` `cookies()`; the
  typed Hono client forwards the cookie on server-side calls.
- Closes issue [#18](https://github.com/seopotion/seo/issues/18).

If only public content is SSR: **no change** — `localStorage` JWT stays, dashboard remains
client-rendered.

### 4. Per-PR preview pipeline — _TBD_

CloudFront + Lambda per PR (or a shared distribution keyed by subdomain), torn down on PR
close. Gated on open question 5. Points at the staging API and renders with mock/empty data
where auth isn't present.

### 5. Frontend CI pipeline (independent)

New GitHub Actions workflow, GitHub OIDC → IAM role (same auth style as A's backend
pipeline, distinct role scoped to the frontend stacks):

- `push` to `dev` → build + deploy `app-staging.`
- `push` to `master` → build + deploy `app.`
- PR into `dev` → build + deploy a `*.preview.` env; comment the URL; destroy on close.
- Concurrency guard per environment.

## Impact on sub-project B

B's original motivation — "remove the route handler so the frontend can be a **pure static
export**" — **no longer holds** under SSR: OpenNext runs route handlers server-side, so
`app/api/wishlist/route.ts` can **stay in Next**. Consequently:

- **B is downgraded from blocker to optional.** Dropping Supabase (the `@supabase/supabase-js`
  dep in `apps/web`) may still be worth it for stack consistency (one datastore, the wishlist
  living behind the Hono API), but it does not gate C.
- Final call on B depends on open question 4 (whether the dev keeps route handlers in Next).

## Out of scope

- Sub-projects **A** (backend envs) and **B** (wishlist migration) beyond the interaction
  notes above.
- **Custom domains + DNS** — deferred; generated CloudFront domains first.
- Any change to backend **business logic**; the only possible backend touch is the
  cookie-auth change in `/core/login` (§3), and only if open question 2 requires it.

## Verification (to be expanded once unblocked)

- `apps/web` builds via OpenNext with no `output: 'export'`; SSR routes return
  server-rendered HTML at the deployed CloudFront URL (crawlable — assert non-empty
  server-rendered markup for the target pages).
- Staging + prod frontends reach their matching backend `HttpApiUrl`; a full flow
  (login → setup → dashboard) works end-to-end against staging.
- If cookie-auth is in scope: authed dashboard pages render logged-in on the **server**
  (no logged-out flash); the JWT no longer appears in `localStorage`.
- A per-PR preview deploys, is reachable, and is destroyed on PR close.
- `npm run check:all` + `npm test` pass; the frontend deploy workflow is green on a real
  staging deploy.
