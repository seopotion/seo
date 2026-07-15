# Domain Rating + Google Search Console — Design

**Issue:** [#12](https://github.com/seopotion/seo/issues/12) · **Gap:** G7 (`design/onboarding-parity-gaps.md`) · **Date:** 2026-07-15

Two independent halves, shipped as **two PRs** (Domain Rating first, then GSC). Both
surface on the dashboard Home page (`design/product-flow.md`, Dashboard §1).

## Part 1 — Domain Rating (PR 1)

Replace the hardcoded `Domain Rating —` header badge with a real number sourced from
**DataForSEO** (already integrated; no new vendor).

### Provider

Add `backlinksSummary(target: string)` to `DataForSeoClient`
(`packages/shared/providers/src/dataforseo/client.ts`), calling
`POST /v3/backlinks/summary/live`. Extract the backlink-graph `rank` (0–1000) and
normalize to **0–100** via `Math.round(rank / 10)` so the badge reads like a Domain
Rating. Reuses the client's existing retry/error handling.

### Schema + storage

- `OrgSchema` (`packages/shared/schemas/src/org.ts`) gains an optional field:
  `domain_rating: { value: int 0–100, checked_at: Date }`.
- `OrgRepo.updateDomainRating(orgId, value)` sets `{ value, checked_at: now }`.
- No history collection — the badge only needs the latest value (Outrank's
  `domain_rating_history` chart is out of scope).

### Worker (scan-time fetch)

During the setup scan, after presets are written, fetch the backlinks summary for the
org's domain and stamp `domain_rating`. **Failure-tolerant:** a DR fetch error is
logged and skipped — it must never fail the scan; the dashboard's stale-refresh
recovers later.

### API

New `GET /dashboard/domain-rating?org_id=` → `{ rating: number | null }`, chained on
the dashboard router (feeds `AppType`). Handler:

1. `loadOwnedOrg` (404 on miss, as elsewhere).
2. If `domain_rating` exists and `checked_at` is ≤ 7 days old → return it.
3. Otherwise re-fetch inline from DataForSEO, persist, return the fresh value.
4. If the inline fetch fails → return the stale value, or `null` if none exists.

### Web

The dashboard header badge (`apps/web/app/dashboard/page.tsx`) fetches the endpoint
alongside the other Home reads and renders `Domain Rating 42` (em-dash when `null`).

### Tests

- Provider: `backlinksSummary` mapping + error paths (mocked fetch).
- Route: fresh value, stale → refresh + persist, provider failure → stale fallback,
  ownership 404 (mocked repo + provider).
- Worker: DR fetch failure does not fail the scan.

## Part 2 — Google Search Console (PR 2)

OAuth authorization-code flow with offline access; live Search Analytics reads ungate
the **Best Articles** and (new) **Search Performance** Home cards.

### Entity

New `gsc_connections` collection — Zod schema in `@shared/schemas`, repository in
`@shared/db`, **unique index on `org_id`** added to `ensureIndexes()`:

```
{
  id, org_id,
  refresh_token_enc: string,        // AES-256-GCM ciphertext
  site_url: string | null,          // null = token stored, property not yet chosen
  google_email: string,
  connected_at: Date,
  last_refresh_failed_at: Date | null,
}
```

**The gate:** an org counts as "GSC-connected" iff a row exists with `site_url` set
and `last_refresh_failed_at` null.

### Secrets & crypto

- Refresh tokens are encrypted with **AES-256-GCM** (Node built-in `crypto`;
  helper in `apps/api/src/lib/crypto.ts`).
- Two new secrets, resolved with the same pattern as the JWT secret
  (`auth/secret.ts`): SSM SecureString named by `*_PARAM` when deployed, plain env
  var locally.
  - `GSC_TOKEN_KEY` — 32-byte encryption key.
  - `GOOGLE_CLIENT_SECRET` — we reuse the existing `GOOGLE_CLIENT_ID` OAuth client
    for both sign-in and this flow.
- **Only the API Lambda** is granted these; the worker never touches GSC.
- Human-gated (called out in the PR, not blocking merge): CDK grant for the two SSM
  params; registering `…/dashboard/gsc/callback` redirect URIs in the Google console.

### OAuth flow (web callback → API exchange)

All endpoints auth-protected and ownership-checked, on the dashboard router:

- `GET /dashboard/gsc/auth-url?org_id=` → `{ url }`. Consent URL with scope
  `webmasters.readonly`, `access_type=offline`, `prompt=consent`,
  `redirect_uri = <web origin>/dashboard/gsc/callback`, and `state` = short-lived
  signed HS256 JWT `{ org_id, user_id }` (reuses our signer; CSRF-proof).
- `POST /dashboard/gsc/connect` `{ code, state }` — verify `state` (its `user_id`
  must match the caller; `org_id` comes from the state, so the callback page never
  carries it), exchange the code server-side (`google-auth-library` `OAuth2Client`,
  already a dependency), encrypt + upsert the refresh token with `site_url: null`,
  list the account's GSC properties, return
  `{ org_id, sites: [{ site_url, permission_level }] }`.
- `POST /dashboard/gsc/site` `{ org_id, site_url }` — validate the choice against a
  fresh site list (reject anything not in the account), set `site_url` → connected.
- `DELETE /dashboard/gsc?org_id=` — disconnect (delete the row); needed to
  re-run the flow.

The redirect URI's web origin comes from a new `WEB_ORIGIN` config value in
`apps/api/src/config.ts` (env var; `http://localhost:3000` for local dev).

Site selection is **user-picked from the list** (not auto-matched) — handles domain
vs url-prefix properties and subdomain mismatches.

### Data reads (live, no sync jobs)

Thin `apps/api/src/clients/gsc.ts`: `OAuth2Client` mints access tokens from the
stored refresh token; plain `fetch` for the two REST calls (sites list, Search
Analytics `query`). No `googleapis` dependency.

- `GET /dashboard/articles/best` — now takes `org_id`; `gated` computed from the
  connection. Gated → `{ articles: [], gated: true }` (shape unchanged). Connected →
  Search Analytics top-10 pages by clicks, last 28 days;
  `BestArticle` becomes `{ url, clicks, title: string | null }` (title from a slug
  match against our published articles when possible, else null).
- New `GET /dashboard/search-performance?org_id=` → `{ gated: true }` or
  `{ gated: false, clicks, impressions, ctr, position }` — 28-day totals.
- On `invalid_grant` (revoked): stamp `last_refresh_failed_at`, respond gated so the
  UI shows a reconnect prompt.

### Web

- **Home:** Best Articles' gated state becomes a "Connect Google Search Console"
  button (fetch auth-url → `window.location`); add the matching **Search
  Performance** card; connected states render top pages / totals. Same bare inline
  styling as the rest of the page.
- **New page** `app/dashboard/gsc/callback/page.tsx`: reads `?code&state`, POSTs
  `connect`, renders the returned site list, user picks → POST `site` → redirect to
  `/dashboard`.

### Tests

- Routes (`testClient`, `vi.mock`ed repo + google client): state verification
  (tampered/expired/foreign state), connect happy path, site-pick validation
  (reject non-listed site), gate logic (no row / pending row / failed-refresh row),
  search-analytics mapping, revoked-token → gated + stamped failure.
- Crypto: encrypt/decrypt round-trip, wrong-key failure.
- Repo integration test: unique `org_id` upsert semantics.

## Out of scope

- Domain-rating history / chart, backlinks cards, backlink-exchange economy.
- Background GSC sync or stored metrics (live reads only).
- Recommended-actions scoring engine; publishing integrations (#7).
