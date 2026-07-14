# Real Website Scanner — Design (#77)

_2026-07-14 — Part of [#77](https://github.com/seopotion/seo/issues/77) "remove all mocks, integrate real llms, DataForSEO APIs"._

## Context

The onboarding scan worker (`apps/worker/src/index.ts`, triggered by SQS from
`POST /setup/start_scan`) currently calls a **mock** `scanWebsite()` that fabricates
onboarding presets deterministically from the URL (`apps/worker/src/scanner.ts`). Everything
else in the product already uses real providers: `@shared/providers` has working DataForSEO,
OpenRouter (LLM) and fal.ai clients, and the keyword/strategy/generation/image pipelines call
them for real. The scanner is the one remaining genuinely-fabricated backend data source.

This design replaces the mock scanner with a real **scrape + LLM** implementation. It is
scoped to the backend scanner only. Frontend onboarding wiring (`buildMockBusinessDescription`,
the disconnected onboarding flow) stays under its own issues (#20/#8); dashboard `best`/
`integrations` stay gated on GSC (#12) / integrations (#7).

## Goal

`scanWebsite(url, { llm })` returns a real, editable `SetupPresets` derived from the actual
website — never fabricated boilerplate. The scan **must always** yield a valid `SetupPresets`
because onboarding gates on it; provider/network failures degrade gracefully rather than
dead-lettering.

## Decisions

- **Competitors are manual, not auto-discovered.** `audience.competitors` is left `[]` by the
  scanner; the user enters competitors in the (editable, pre-populated) onboarding form. The LLM
  is instructed **not** to produce competitors — no hallucinated domains, no wasted tokens.
  Consequently **the scanner uses no DataForSEO** — DataForSEO stays where it already is, in the
  keyword/strategy pipeline. Downstream article generation reads `competitors` from the saved org
  presets; it is `[]` at scan time and populated by the user during onboarding, well before any
  paid generation runs.
- **Blog URLs are real, from the sitemap.** `sitemap_url` / `main_blog_url` / `best_articles`
  come from parsing `robots.txt` → sitemap, not from LLM guesses.
- **`audience.target` and all prose fields stay LLM-generated** from the scraped page.
- **No deterministic mock fallback is kept.** A hard LLM failure re-throws → SQS retry → DLQ
  (existing `index.ts` behavior). Keeping the old mock would defeat the issue.
- **Scanner logic stays in `apps/worker/src/`** — it has no consumer outside the worker, so no
  `@shared/scanner` package. This mirrors the worker owning its own `scanner.ts` today.

## Data flow

`scanWebsite(url, { llm })` runs three best-effort steps, then assembles a validated `SetupPresets`:

1. **Scrape homepage** — `fetchSite(url)`: `fetch` with a browser-ish `User-Agent` and a timeout
   → strip `<script>` / `<style>` / tags to visible text (whitespace-collapsed, truncated to a
   char budget) + collect `<a href>` links (absolute-ized). Returns `null` on network failure.
2. **Discover blog (real URLs)** — `discoverBlog(url, links)`: fetch `/robots.txt`, read
   `Sitemap:` lines (fallback `/sitemap.xml`); fetch the sitemap, parse `<loc>` entries (follow a
   sitemap index one level deep, capped). Derive `sitemap_url` (the sitemap actually found),
   `main_blog_url` (nav/loc URL whose path contains `blog`, else homepage-derived default), and a
   few `best_articles` (blog-path `<loc>`s). Best-effort: no sitemap → sensible URL defaults.
3. **Generate presets (LLM)** — one `llm.complete({ responseFormat: 'json' })` call
   (mirrors `@shared/generation`'s `outline.ts`) fed the scraped text + discovered blog URLs.
   Prompt asks for every `SetupPresets` field **except competitors**. Parse with `parseJsonObject`
   (reused from `@shared/generation`) → validate with `SetupPresetsSchema`.

**Assembly — real deterministic data wins.** Final presets = LLM prose fields, with
`blog` overridden by the sitemap-discovered URLs and `audience.competitors` forced to `[]`.
If the homepage fetch failed (step 1 `null`), the LLM is seeded with just the domain so the scan
still completes with a valid (if thinner) preset.

## Files

- `apps/worker/src/scanner.ts` — **rewrite**: orchestrator + `buildScanPrompt` / preset parse.
  Signature becomes `scanWebsite(url: string, clients: { llm: LlmClient }): Promise<SetupPresets>`.
- `apps/worker/src/scrape.ts` — **new**: `fetchSite()` (HTML → text + links), `discoverBlog()`.
  Pure functions over `fetch`, no client deps.
- `apps/worker/src/providers.ts` — add `getScanClients()` → `{ llm: createOpenRouterClient(...) }`.
- `apps/worker/src/index.ts` — pass `getScanClients()` into `scanWebsite(website_url, ...)`.
- `infra/lib/api-stack.ts` — **required**: `WorkerFn` env gains `OPENROUTER_API_KEY`
  (today it has only `mongoEnv`). Mirror how `StrategyWorkerFn` sets it. No DataForSEO creds.
- `apps/worker/tests/scanner.test.ts` — **rewrite** (see Testing).
- Cleanup: stale `"mock"` wording in `apps/api/src/routes/dashboard.ts` (line ~227) and
  `apps/api/src/schemas/dashboard.ts` header comment — those routes read real repo data now.

## Config / constants

Small module-level constants in `scanner.ts` / `scrape.ts` (no new env beyond the API key):
`FETCH_TIMEOUT_MS`, `SCRAPE_CHAR_BUDGET` (~8k), `USER_AGENT`, `MAX_BEST_ARTICLES`,
sitemap fetch cap. Model defaults to the OpenRouter client's default (`anthropic/claude-sonnet-4.6`).

## Error handling

- Homepage fetch fails → `fetchSite` returns `null`; scan continues LLM-only from the domain.
- `robots.txt`/sitemap fails or absent → blog falls back to derived defaults (`/sitemap.xml`,
  `/blog`), no throw.
- LLM returns unparseable / schema-invalid JSON after its own retries → `scanWebsite` throws →
  `index.ts` re-throws → SQS redelivers → DLQ after `maxReceiveCount`. Matches today's behavior;
  onboarding stays `setup_scan_in_progress` until retries exhaust.

## Testing (`apps/worker/tests/scanner.test.ts`, rewrite)

Vitest, following `strategy.test.ts` conventions. Mock the `llm` client (a `vi.fn()` returning a
canned JSON string) and stub global `fetch` (`vi.stubGlobal`) for homepage / robots / sitemap.

- **Happy path** — mocked homepage + sitemap + LLM JSON → result validates against
  `SetupPresetsSchema`; `blog.*` equals the sitemap-derived URLs (LLM's blog guess ignored);
  `audience.competitors` is `[]`; prose fields come from the LLM JSON.
- **No sitemap** — robots/sitemap fetch 404 → blog falls back to derived defaults; still valid.
- **Homepage fetch failure** — `fetch` rejects → LLM seeded with domain only → still a valid
  `SetupPresets`.
- **LLM produces invalid JSON** → `scanWebsite` rejects (so the worker dead-letters).

## Out of scope

Frontend onboarding wiring (#20/#8), dashboard `best`/`integrations` (#12/#7), integrations (#7).
The competitor-entry UI is frontend work; this change only guarantees the scanner leaves the
field empty and downstream reads it correctly.
