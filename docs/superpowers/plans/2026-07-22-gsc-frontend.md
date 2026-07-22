# Google Search Console — Frontend Integration (self-contained implementation prompt)

> **For agentic workers:** this document is a complete, self-contained prompt. Read the
> whole thing before writing code. After this plan is implemented, the GSC integration is
> feature-complete end to end (connect → pick property → live dashboard data → disconnect).

**Goal:** expose the fully built, merged GSC backend (#12, PR #100) in the real product UI:
a working connect flow in Settings, the OAuth callback + property picker page, and live
Search Performance / Best Articles data on Home. Plus one tiny backend addition (a status
endpoint) that the Settings panel needs.

**Branch:** `alper-gsc` (already created off `dev`, currently clean). PR into `dev`.
PR body: `Closes #83` (the old GSC stub issue) and references #12 / PR #100. Never commit
to `dev` directly.

---

## 1. Context — what exists today

### Backend (merged, do not modify except Task 1)

Routes mounted at `/api/v0/dashboard/gsc` (`apps/api/src/routes/gsc.ts`), all Bearer-JWT +
org-ownership checked, reachable through the typed client as `api.api.v0.dashboard.gsc.*`:

| Endpoint | Client call | Returns |
| --- | --- | --- |
| `GET /auth-url?org_id=` | `api.api.v0.dashboard.gsc['auth-url'].$get({ query: { org_id } })` | `{ url }` — Google consent URL (offline access, `webmasters.readonly`, signed CSRF `state`) |
| `POST /connect` | `...gsc.connect.$post({ json: { code, state } })` | `{ org_id, sites: [{ site_url, permission_level }] }` — exchanges the OAuth code server-side, stores the encrypted refresh token with `site_url: null` (pending), returns the account's GSC properties |
| `POST /site` | `...gsc.site.$post({ json: { org_id, site_url } })` | `{ ok: true }` — finalizes; server re-validates the site against a fresh Google list |
| `DELETE /?org_id=` | `...gsc.index.$delete({ query: { org_id } })` | `{ ok }` — disconnect, deletes the stored token |

Dashboard data endpoints already do **live GSC reads** and gate on connection health
(`apps/api/src/routes/dashboard.ts`):

- `GET /api/v0/dashboard/articles/best?org_id=` → `{ gated: boolean, articles: [{ url, clicks, title: string | null }] }` — top 10 pages by clicks, trailing 28 days; `title` is matched against our published articles by slug (null for other site pages).
- `GET /api/v0/dashboard/search-performance?org_id=` → `{ gated: boolean, clicks, impressions, ctr, position }` — 28-day totals; all numbers `null` while gated. `ctr` is a 0..1 fraction; `position` is the average position.
- Both return `gated: true` when there is no healthy connection **or** when Google reports the grant revoked (the API auto-marks `last_refresh_failed_at`, closing the gate until reconnect).

### The hard constraint: the OAuth redirect URI

`apps/api/src/clients/gsc.ts:20` builds the redirect URI as
**`${WEB_ORIGIN}/dashboard/gsc/callback`** — this exact path is registered in the Google
Cloud console. Do **not** change it.

Routing consequence: `apps/web/proxy.ts` runs next-intl on every non-asset path, and with
`localePrefix: 'as-needed'` an unprefixed request like `/dashboard/gsc/callback` is
internally rewritten to `/en/dashboard/gsc/callback`. Therefore:

- The callback page must live at **`apps/web/app/[locale]/dashboard/gsc/callback/page.tsx`** (outside the `(authenticated)`/`(product)` route groups — see Task 4).
- The legacy pre-locale pages under **`apps/web/app/dashboard/`** (the old mock dashboard and old callback) are unreachable dead code and must be **deleted** in this PR.
- Google always redirects to the unprefixed URL, so the callback renders in the default (`en`) locale even for `tr` users. Accepted MVP tradeoff for the picker itself; the final redirect restores the user's locale via a sessionStorage key (Task 2/4).

### Current product UI gaps (what this plan fixes)

- Settings → "Google Search Console" tab: hardcoded "Coming soon" + disabled button (`apps/web/app/[locale]/(authenticated)/(product)/settings/page.tsx`, the `settings-panel-googleSearchConsole` block).
- Home (`.../home/page.tsx`): fetches only `gated` from best-articles, renders a static message; never fetches `search-performance`; the "Connect Google Search Console" recommended action has no `href` (`home-utils.ts`).
- No way anywhere in the product to start the OAuth flow.

### Patterns to copy (read these files first)

- `apps/web/app/[locale]/(authenticated)/(product)/settings/_components/IntegrationsPanel.tsx` — the style reference for Settings panels: react-query mutation, error mapping, badges, `StatusPanel`, `Intl.DateTimeFormat` for dates.
- `apps/web/lib/integrations.ts` (`useConnectedIntegrations`) — the hook pattern to mirror for the status query (401 → `onUnauthorized`, `staleTime`, `enabled`).
- `apps/web/app/dashboard/gsc/callback/page.tsx` (the file you'll delete) — the proven callback logic: Suspense boundary for `useSearchParams`, `useRef` guard against Strict-Mode double code exchange, error/picker/saving states. Rebuild this logic in the new page with product styling.
- `apps/web/components/ui/index.ts` — available primitives: Alert, Badge, Button, Card, Input, Label, Select, Separator, etc. Icons come from `lucide-react` (already a dependency). **Do not add a Google/GSC logo asset** — use a lucide icon (e.g. `Search` or `BarChart3`) to avoid fabricating brand art.

### Repo conventions that will bite you

- `verbatimModuleSyntax`: `import type` for type-only imports.
- Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- Backend routes stay **chained** with `.openapi(...)` so `AppType` captures them.
- The whole Settings page is one `<form>` — every button inside a Settings panel **must be `type="button"`** or it will submit the general-settings form.
- The callback page is outside the `(product)` group, so there is **no `QueryClientProvider`** there — use plain `useState`/`useEffect` + the `api` client, never react-query, on that page.
- `Link`/`useRouter` come from `@/i18n/navigation` (locale-aware), not `next/navigation` — except `useSearchParams`, which is fine from `next/navigation`.

---

## 2. UX design

### Connect flow (happy path)

1. User opens **Settings → Google Search Console** tab (directly, or via the Home nudges — the recommended action and both gated cards link to `/settings?tab=googleSearchConsole`).
2. Not-connected panel explains the value (unlocks Search Performance + Best Articles on Home) and notes the access is **read-only**. User clicks **"Connect with Google"**.
3. Frontend: `GET auth-url` → stores the current locale in `sessionStorage` → `window.location.href = url` (full-page navigation to Google consent).
4. Google redirects to `/dashboard/gsc/callback?code=…&state=…`. The callback page POSTs `/connect`, then shows the **property picker**: all the account's GSC properties, with the one matching the org's `website_url` preselected and badged "Recommended".
5. User confirms → `POST /site` → redirect to `/settings?tab=googleSearchConsole&connected=1` in the user's original locale → Settings shows the **connected panel** plus a one-time success banner.
6. Home now renders live data in both cards.

### Settings panel states

| State | Trigger | UI |
| --- | --- | --- |
| Loading | status query pending | neutral text |
| Load error | status query failed | red panel |
| Not connected | `connected: false, needs_reconnect: false` (includes the abandoned-mid-flow "pending property" case — the flow simply restarts) | explainer: description, 2 benefit bullets, read-only note, primary **Connect with Google** button |
| Needs reconnect | `needs_reconnect: true` (Google revoked/expired the grant) | amber warning + **Reconnect** button (same connect handler) |
| Connected | `connected: true` | green "Connected" badge, Google account email, property (`site_url`), connected-on date, **Change account or property** (secondary, same connect handler — the picker lets them re-choose) and **Disconnect** (two-step inline confirm) |
| Just connected | arrived with `?connected=1` | success banner on top of the connected state; param stripped from the URL after reading |

### Callback page states

exchanging (spinner text) → picker (radio-style list, Recommended badge, confirm button) →
saving → redirect. Plus: cancelled/failed error (Google `error` param or missing
`code`/`state`), exchange-failed error, save-failed error, and the "no properties in this
account" empty state (link out to https://search.google.com/search-console + back to
settings). No token in localStorage → `router.replace('/')`.

### Home cards

- **Search Performance** (new 4th card): subtitle "Last 28 days"; 2×2 stats — Clicks (integer), Impressions (integer), CTR (percent, 1 decimal, from the 0..1 fraction), Avg. position (1 decimal). Numbers via `Intl.NumberFormat(locale)`.
- **Best Articles** (now real): subtitle "Top pages by clicks — last 28 days"; up to 5 rows: article title (fallback: URL pathname, or hostname for `/`), external link opening the page in a new tab, click count right-aligned. Connected-but-empty keeps the existing `empty` message.
- Both cards, when gated: existing gated copy + a `Link` CTA to `/settings?tab=googleSearchConsole`.

---

## 3. Tasks

### Task 1 — Backend: `GET /dashboard/gsc/status` (the only backend change)

The Settings panel needs connection state (email, property, health) without triggering
Google reads. Pure DB read, no token decryption, no Google calls.

**Files:** modify `apps/api/src/schemas/gsc.ts`, `apps/api/src/routes/gsc.ts`,
`apps/api/tests/gsc.test.ts`.

Add to `apps/api/src/schemas/gsc.ts`:

```ts
export const GscStatusResponse = z
  .object({
    connected: z.boolean(),
    google_email: z.string().nullable(),
    site_url: z.string().nullable(),
    connected_at: z.string().nullable(),
    needs_reconnect: z.boolean(),
  })
  .openapi('GscStatusResponse');
```

Add a chained `.openapi(...)` route to `apps/api/src/routes/gsc.ts` (GET `/status`,
`tags: ['gsc']`, `security` + `authMiddleware` + `request: { query: schemas.GscOrgQuery }`
exactly like the existing routes; 200 + 404 responses). Handler:

```ts
async (c) => {
  const { org_id } = c.req.valid('query');
  const { userId } = c.get('auth');
  const org = await loadOwnedOrg(org_id, userId);
  if (!org) return c.json({ error: 'Not found' }, 404);
  const conn = await GscConnectionRepo.findByOrgId(org_id);
  return c.json(
    {
      connected: isGscConnected(conn),
      google_email: conn?.google_email ?? null,
      site_url: conn?.site_url ?? null,
      connected_at: conn ? conn.connected_at.toISOString() : null,
      needs_reconnect: conn !== null && conn.last_refresh_failed_at !== null,
    },
    200,
  );
},
```

`isGscConnected` comes from `@shared/schemas` (gate: row exists AND `site_url` set AND
`last_refresh_failed_at` null). The route file doesn't import it yet — add the import.

**Tests** — extend the existing `describe` blocks in `apps/api/tests/gsc.test.ts` (the
`connections` Map mock already produces correctly shaped rows; simulate revocation by
mutating a row directly, e.g. `connections.get('org_1')!.last_refresh_failed_at = new Date()`):

1. No row → `{ connected: false, google_email: null, site_url: null, connected_at: null, needs_reconnect: false }`.
2. After `/connect` (pending property) → `connected: false`, `google_email: 'owner@x.com'`, `site_url: null`, `needs_reconnect: false`, `connected_at` an ISO string.
3. After `/site` → `connected: true`, `site_url` set.
4. Row with `last_refresh_failed_at` set → `connected: false`, `needs_reconnect: true`.
5. `org_3` (not owned) → 404.

Typed client path becomes `api.api.v0.dashboard.gsc.status.$get({ query: { org_id } })`.

### Task 2 — Web plumbing: query key + `lib/gsc.ts`

**Files:** modify `apps/web/lib/dashboard-query-keys.ts`; create `apps/web/lib/gsc.ts`;
create `apps/web/tests/gsc.test.ts`.

Add to `dashboardQueryKeys`:

```ts
gscStatus: (organizationId: string) =>
  [...dashboardQueryKeys.organization(organizationId), 'gsc', 'status'] as const,
```

`apps/web/lib/gsc.ts` exports:

- `export const GSC_RETURN_LOCALE_KEY = 'seo_gsc_return_locale';` — written by the Settings panel before redirecting to Google, read + cleared by the callback page for the final redirect.
- `export type GscStatus = { connected: boolean; google_email: string | null; site_url: string | null; connected_at: string | null; needs_reconnect: boolean };`
- `export type GscSite = { site_url: string; permission_level: string };`
- `useGscStatus(organization: ProductOrganization | null, options?: { onUnauthorized?: () => void })` — mirror `useConnectedIntegrations` in `lib/integrations.ts` exactly (queryKey `dashboardQueryKeys.gscStatus(...)`, 401 → `onUnauthorized` + throw `'unauthorized'`, `!ok` → throw, `enabled: Boolean(organization)`, `refetchOnWindowFocus: false`, `staleTime: 5 * 60 * 1000`).
- The property-matching helper:

```ts
/** Best-guess GSC property for the org's website: sc-domain match wins, then URL-prefix host match. */
export function matchGscProperty(websiteUrl: string, sites: GscSite[]): string | null {
  let hostname: string;
  try {
    hostname = new URL(websiteUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const domainMatch = sites.find((site) => {
    if (!site.site_url.startsWith('sc-domain:')) return false;
    const domain = site.site_url.slice('sc-domain:'.length);
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
  if (domainMatch) return domainMatch.site_url;
  const urlMatch = sites.find((site) => {
    if (site.site_url.startsWith('sc-domain:')) return false;
    try {
      return new URL(site.site_url).hostname.replace(/^www\./, '') === hostname;
    } catch {
      return false;
    }
  });
  return urlMatch ? urlMatch.site_url : null;
}
```

**Test** (`apps/web/tests/gsc.test.ts`, pure Vitest like `tests/home-utils.test.ts`): cover
sc-domain exact match, sc-domain subdomain match (`blog.x.com` → `sc-domain:x.com`),
www-stripping on both sides, URL-prefix match preferred only when no sc-domain match,
no match → null, invalid `websiteUrl` → null.

### Task 3 — Settings: `GoogleSearchConsolePanel`

**Files:** create
`apps/web/app/[locale]/(authenticated)/(product)/settings/_components/GoogleSearchConsolePanel.tsx`;
modify `.../settings/page.tsx`.

In `settings/page.tsx`: replace the hardcoded contents of the
`settings-panel-googleSearchConsole` tabpanel div with
`<GoogleSearchConsolePanel organization={organization} onUnauthorized={handleUnauthorized} />`
(same props contract as `IntegrationsPanel`). The tab itself, tab strings, and everything
else on the page stay untouched.

Panel implementation (`'use client'`, styled like `IntegrationsPanel` — slate borders,
white cards, its own local `StatusPanel`):

- `useGscStatus(organization, { onUnauthorized })` drives the five states from §2.
- **Connect / Reconnect / Change** all share one handler:
  ```ts
  async function startConnect() {
    if (!organization) return;
    // guard with a `connecting` state; on any failure show the connectError panel
    const res = await api.api.v0.dashboard.gsc['auth-url'].$get({
      query: { org_id: organization.id },
    });
    // 401 -> onUnauthorized(); !ok -> error state
    window.sessionStorage.setItem(GSC_RETURN_LOCALE_KEY, locale); // useLocale()
    window.location.href = (await res.json()).url;
  }
  ```
- **Disconnect**: two-step inline confirm (click "Disconnect" → row swaps to confirm text + "Yes, disconnect" / "Cancel"). Confirm runs a `useMutation` calling `api.api.v0.dashboard.gsc.index.$delete({ query: { org_id } })`; 401 → `onUnauthorized`. On success: `queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.gscStatus(orgId) })` **and** `queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.home(orgId) })` (so Home re-locks in the same SPA session). On failure: error panel, stay connected.
- **`?connected=1` success banner**: in a mount-only `useEffect`, read `window.location.search` (same pattern as the page's existing `tab` effect); if present, set a local `justConnected` flag, invalidate the `gscStatus` + `home` keys, and strip the param via `window.history.replaceState` so refresh/back doesn't replay the banner.
- Connected details render email, `site_url` verbatim (users recognize `sc-domain:example.com`), and the date via `Intl.DateTimeFormat(locale, { dateStyle: 'medium' })`.
- Every button `type="button"`. Buttons disabled while `!organization` or a request is in flight.
- All copy from the `SettingsPage.googleSearchConsole` namespace (§4) — the three existing keys (`comingSoon` etc.) are replaced by the new set in both locales.

### Task 4 — The callback page (+ delete the legacy tree)

**Files:** create `apps/web/app/[locale]/dashboard/gsc/callback/page.tsx`;
**delete `apps/web/app/dashboard/` entirely** (both `page.tsx` and `gsc/callback/page.tsx`;
verify nothing imports from that tree first).

Structure: default export wraps the inner component in `<Suspense>` (required for
`useSearchParams`); `'use client'`; **no react-query** (no provider outside `(product)`).
Port the logic of the old callback page, restyled as a centered card (`max-w-md mx-auto`,
slate styling consistent with the product) with the `GscCallback` i18n namespace:

- No `getToken()` → `router.replace('/')` (router from `@/i18n/navigation`).
- Google `error` param, or missing `code`/`state` → `errors.cancelled` state with a "Back to settings" link (`Link` to `/settings?tab=googleSearchConsole`).
- `useRef` guard so Strict Mode's double effect never POSTs the same single-use code twice (copy the `exchanged` ref pattern verbatim from the old page).
- `POST /connect`: 401 → `clearToken()` + `router.replace('/')`; other failures → `errors.exchangeFailed`. On success, also fetch `api.api.v0.core.organizations.$get()` and find the org by the returned `org_id` to get `website_url` for `matchGscProperty` — **non-fatal** if this fails (no preselection, picker still works).
- Picker: heading + body copy, list of properties as selectable rows (radio semantics — `role="radio"`/`aria-checked` or real inputs), each showing `site_url` (medium) and `permission_level` (subdued small); the matched property preselected with a "Recommended" badge; primary confirm button disabled until a selection exists, `saving` label while pending.
- `sites.length === 0` → `noSites` message + external link to `https://search.google.com/search-console` (`target="_blank" rel="noopener noreferrer"`) + back-to-settings link.
- `POST /site` success → restore locale and leave:
  ```ts
  const locale = window.sessionStorage.getItem(GSC_RETURN_LOCALE_KEY) ?? currentLocale;
  window.sessionStorage.removeItem(GSC_RETURN_LOCALE_KEY);
  router.replace('/settings?tab=googleSearchConsole&connected=1', { locale });
  ```
  Failure → `errors.siteFailed`, re-enable the picker.

### Task 5 — Home: live data + working nudges

**Files:** modify `.../home/page.tsx`, `.../home/home-utils.ts`,
`apps/web/tests/home-utils.test.ts`.

`home/page.tsx`:

- Extend `HomeData`: replace `bestGated: boolean` with
  `best: { gated: boolean; articles: { url: string; clicks: number; title: string | null }[] }`
  and add `perf: { gated: boolean; clicks: number | null; impressions: number | null; ctr: number | null; position: number | null }`.
  Update `emptyHomeData` accordingly (both gated, empty/nulls).
- Add `api.api.v0.dashboard['search-performance'].$get({ query: { org_id } })` to the
  existing `Promise.all` (it joins the 401 check like the others). Parse both full bodies
  instead of just `gated`.
- `recommendedActions` input keeps `bestGated: data.best.gated`.
- **Best Articles card**: gated → gated text + `Link` CTA to `/settings?tab=googleSearchConsole`; connected + empty → existing `empty` string; data → subtitle + up to 5 rows (`articles.slice(0, 5)`): `<a href={url} target="_blank" rel="noopener noreferrer">` with `title ?? pathLabel(url)` (truncate long labels) and the formatted click count. `pathLabel`: `new URL(url).pathname`, falling back to the hostname when pathname is `/`, and to the raw string on parse failure.
- **Search Performance card** (new, after Best Articles — the grid is already `xl:grid-cols-4`): gated → same gated treatment; otherwise subtitle + 2×2 grid reusing the local `Stat` component. Formatting: clicks/impressions `new Intl.NumberFormat(locale).format(Math.round(v ?? 0))`; CTR `new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(perf.ctr ?? 0)`; position `(perf.position ?? 0).toFixed(1)`. Get `locale` from `useLocale()`.

`home-utils.ts`: the `connectSearchConsole` action gets a destination —

```ts
const SETTINGS_GSC_HREF = '/settings?tab=googleSearchConsole';
// ...
if (input.bestGated) {
  actions.push({ href: SETTINGS_GSC_HREF, key: 'connectSearchConsole' });
}
```

Update the assertion in `apps/web/tests/home-utils.test.ts` that currently expects
`connectSearchConsole` without an `href`.

### Task 6 — i18n (en + tr)

Apply the JSON in §4 to `apps/web/messages/en.json` and `apps/web/messages/tr.json`.
Rules: **replace** the whole `SettingsPage.googleSearchConsole` object; **add** keys into
`HomePage.bestArticles` (keep `title`, `gated`, `empty`); **add** `HomePage.searchPerformance`
and the top-level `GscCallback` namespace. Keep keys alphabetized within objects like the
rest of the files.

### Task 7 — Bookkeeping

- `PROGRESS.md`: line 42's "Home `best`… stay mock/empty — gated on GSC" and line 43's
  GSC entry are now done — update them to ✅ one-liners still linking `[#12]`, and note the
  only remainder is ops (`[#108]`: staging Google client secret + live smoke test). Keep it
  terse; detail belongs in the PR body.
- PR body: what changed (Settings connect flow, callback/property picker, live Home cards,
  status endpoint), `Closes #83`, references #12 / PR #100, and lists what's intentionally
  left open: #101, #102, #103 (backend follow-ups) and #108 (staging ops).

### Task 8 — Verification

1. `npm run lint` (after `npm run lint:fix` on new files), `npm run check:all`, `npm test` — all green. `check:all` is the proof the typed client picked up the new status route.
2. `npm test -- gsc` — old 29 GSC tests plus the new status + web tests pass.
3. Manual smoke (optional — needs real Google OAuth credentials in the root `.env`:
   `GOOGLE_CLIENT_SECRET`, `GSC_TOKEN_KEY` (`openssl rand -base64 32`), and
   `http://localhost:3000/dashboard/gsc/callback` registered as a redirect URI in the GCP
   console — see `ENVIRONMENTS.md`): `docker compose up -d && npm run dev`, log in, Settings
   → GSC → Connect → consent → pick property → land back connected → Home shows both cards
   live → Disconnect re-locks Home. If credentials aren't available, state that the live
   OAuth round-trip was not exercised (it's also tracked by #108) — do not claim it was.

---

## 4. Copy — exact i18n strings

### `en.json`

`SettingsPage.googleSearchConsole` (replaces the existing object):

```json
{
  "badges": { "connected": "Connected", "notConnected": "Not connected" },
  "benefit1": "Clicks, impressions, CTR and average position for the last 28 days",
  "benefit2": "Your best-performing articles, ranked by real Google Search clicks",
  "changeConnection": "Change account or property",
  "connect": "Connect with Google",
  "connectError": "Could not start the Google connection. Please try again.",
  "connectedAccount": "Google account",
  "connectedOn": "Connected on {date}",
  "connectedSuccess": "Google Search Console connected. Your search data is now live on Home.",
  "connecting": "Opening Google...",
  "description": "See how your site performs in Google Search — clicks, impressions and your best articles — right on your Home dashboard.",
  "disconnect": "Disconnect",
  "disconnectCancel": "Cancel",
  "disconnectConfirm": "Disconnect Search Console? The performance cards on Home will lock again.",
  "disconnectConfirmYes": "Yes, disconnect",
  "disconnectError": "Could not disconnect. Please try again.",
  "property": "Property",
  "readOnlyNote": "SEO Potion only reads your Search Console data. It never changes anything in your Google account.",
  "reconnect": "Reconnect",
  "reconnectNeeded": "Access to Search Console was revoked or expired. Reconnect to keep your search data flowing.",
  "statusError": "Could not load the Search Console connection state.",
  "statusLoading": "Checking the Search Console connection...",
  "title": "Google Search Console"
}
```

`HomePage.bestArticles` — add alongside the existing keys:

```json
{
  "clicks": "{count, plural, one {# click} other {# clicks}}",
  "gatedCta": "Connect Search Console",
  "subtitle": "Top pages by clicks — last 28 days"
}
```

`HomePage.searchPerformance` (new):

```json
{
  "clicks": "Clicks",
  "ctr": "CTR",
  "gated": "Connect Google Search Console to see your search performance.",
  "gatedCta": "Connect Search Console",
  "impressions": "Impressions",
  "position": "Avg. position",
  "subtitle": "Last 28 days",
  "title": "Search Performance"
}
```

`GscCallback` (new top-level namespace):

```json
{
  "backToSettings": "Back to settings",
  "confirm": "Use this property",
  "errors": {
    "cancelled": "The Google connection was cancelled or failed.",
    "exchangeFailed": "We couldn't complete the Google connection. Please try again from Settings.",
    "siteFailed": "We couldn't save that property. Please try again."
  },
  "exchanging": "Completing the Google connection...",
  "noSites": "This Google account has no Search Console properties. Add your site to Search Console, then try connecting again.",
  "openGsc": "Open Google Search Console",
  "pickBody": "Pick the property that matches your website.",
  "pickTitle": "Choose your website's property",
  "recommended": "Recommended",
  "saving": "Saving...",
  "title": "Connect Google Search Console"
}
```

### `tr.json`

`SettingsPage.googleSearchConsole`:

```json
{
  "badges": { "connected": "Bağlı", "notConnected": "Bağlı değil" },
  "benefit1": "Son 28 günün tıklama, gösterim, TO ve ortalama konum verileri",
  "benefit2": "Gerçek Google Arama tıklamalarına göre en iyi performans gösteren makaleleriniz",
  "changeConnection": "Hesabı veya mülkü değiştir",
  "connect": "Google ile bağlan",
  "connectError": "Google bağlantısı başlatılamadı. Lütfen tekrar deneyin.",
  "connectedAccount": "Google hesabı",
  "connectedOn": "{date} tarihinde bağlandı",
  "connectedSuccess": "Google Search Console bağlandı. Arama verileriniz artık Ana Sayfa'da.",
  "connecting": "Google açılıyor...",
  "description": "Sitenizin Google Arama'daki performansını — tıklamaları, gösterimleri ve en iyi makalelerinizi — doğrudan Ana Sayfa panelinizde görün.",
  "disconnect": "Bağlantıyı kes",
  "disconnectCancel": "Vazgeç",
  "disconnectConfirm": "Search Console bağlantısı kesilsin mi? Ana Sayfa'daki performans kartları yeniden kilitlenecek.",
  "disconnectConfirmYes": "Evet, bağlantıyı kes",
  "disconnectError": "Bağlantı kesilemedi. Lütfen tekrar deneyin.",
  "property": "Mülk",
  "readOnlyNote": "SEO Potion, Search Console verilerinizi yalnızca okur. Google hesabınızda hiçbir şeyi değiştirmez.",
  "reconnect": "Yeniden bağlan",
  "reconnectNeeded": "Search Console erişimi iptal edilmiş veya süresi dolmuş. Arama verilerinizin akmaya devam etmesi için yeniden bağlanın.",
  "statusError": "Search Console bağlantı durumu yüklenemedi.",
  "statusLoading": "Search Console bağlantısı kontrol ediliyor...",
  "title": "Google Search Console"
}
```

`HomePage.bestArticles` additions:

```json
{
  "clicks": "{count, plural, other {# tıklama}}",
  "gatedCta": "Search Console'u bağla",
  "subtitle": "Tıklamaya göre en iyi sayfalar — son 28 gün"
}
```

`HomePage.searchPerformance`:

```json
{
  "clicks": "Tıklamalar",
  "ctr": "TO",
  "gated": "Arama performansınızı görmek için Google Search Console'u bağlayın.",
  "gatedCta": "Search Console'u bağla",
  "impressions": "Gösterimler",
  "position": "Ort. konum",
  "subtitle": "Son 28 gün",
  "title": "Arama Performansı"
}
```

`GscCallback`:

```json
{
  "backToSettings": "Ayarlara dön",
  "confirm": "Bu mülkü kullan",
  "errors": {
    "cancelled": "Google bağlantısı iptal edildi veya başarısız oldu.",
    "exchangeFailed": "Google bağlantısı tamamlanamadı. Lütfen Ayarlar'dan tekrar deneyin.",
    "siteFailed": "Bu mülk kaydedilemedi. Lütfen tekrar deneyin."
  },
  "exchanging": "Google bağlantısı tamamlanıyor...",
  "noSites": "Bu Google hesabında Search Console mülkü yok. Sitenizi Search Console'a ekleyin ve yeniden bağlanmayı deneyin.",
  "openGsc": "Google Search Console'u aç",
  "pickBody": "Web sitenize karşılık gelen mülkü seçin.",
  "pickTitle": "Sitenizin mülkünü seçin",
  "recommended": "Önerilen",
  "saving": "Kaydediliyor...",
  "title": "Google Search Console'u Bağla"
}
```

---

## 5. Out of scope (do not touch)

- The OAuth backend flow, redirect URI, crypto, state signing, worker, infra/CDK.
- Open follow-ups #101 (state-token purpose check as session Bearer), #102 (access-token
  reuse), #103 (`listSites` error handling in connect/site routes), #108 (staging secret +
  live smoke test — ops).
- The `googleSearchConsole` **tab** mechanics in Settings (tabs already work).
- Any other Home card, robots.ts (already disallows `/dashboard`), or the WordPress panels.
