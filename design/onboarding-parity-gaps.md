# Onboarding Parity Gaps (vs. Outrank)

**Status:** intentional. These gaps are **deliberate deferrals** — we are shipping a
**baseline onboarding first**, then expanding from it. This doc is the backlog of what
a mature onboarding adds on top of our baseline, captured by walking the live Outrank
(outrank.so) onboarding end-to-end on 2026-07-01 and cross-referencing it against our
`SetupPresetsSchema` and `/setup/*` routes.

Baseline flow lives in [`product-flow.md`](product-flow.md). Source of truth for preset
shape is [`packages/shared/schemas/src/presets.ts`](../packages/shared/schemas/src/presets.ts).

## Flow-level parity (what we already match)

Our baseline mirrors Outrank's spine 1:1:

| Outrank | Ours | Notes |
| --- | --- | --- |
| Enter URL → "instantly gather info" | `/setup` → `POST /setup/start_scan` → SQS `ScanTask` → worker | same async pattern |
| "Scanning…" progress | `setup_scan_in_progress` + poll `GET /setup/status` | same |
| Multi-step review of gathered data | `GET /setup/details` → `PATCH /setup/presets` | ours = one patch; theirs = per-step save |
| Finish → dashboard | `POST /setup/finalize` → `setup_complete` | same terminal state |

Outrank's review wizard steps (**Business → Audience & Competitors → Blog → Articles →
Integration**) map onto our four `SetupPresetsSchema` top-level keys — except
**Integration**, which we don't model (see G1).

## Gap backlog (deferred, prioritized)

### G1 — No integrations / publishing model *(already tracked in PROGRESS.md)*
Outrank's Integration step connects a CMS to auto-publish articles (WordPress, Notion,
Webflow, Shopify, Wix, WordPress.com, API Webhook, Framer, Ghost, Next.js Blog, Feather).
We capture *where the blog is* (`blog.sitemap_url` / `blog.main_blog_url`) but have **no
connected-CMS entity and no OAuth/token storage**. `⬜ GET/POST /setup/integrations` is
the placeholder. Largest missing subsystem; deferred because auth/token handling per
platform is expensive.

### G2 — `article_preferences` is a thin subset (~4 of ~20 controls)
Baseline: `content_seo.{article_style, internal_links, llm_instructions}` +
`engagement.{image_style}`.
Outrank additionally exposes, on the Articles step:
- **Content/SEO:** auto-publish toggle; internal-links as a **count** (see G5).
- **Engagement toggles:** brand color; Title-Based Featured Image (+ its own style);
  Table of Contents; YouTube video; Call-to-Action; Infographics; Emojis; Mention
  Similar Products & Tools; First-Person Writing; custom AI image-style presets.
- **Improvement Schedule** (whole subsystem): auto-improve existing articles, auto-push
  to integration, weekday picker (max 2 days/week).
- **Product Catalog** (whole subsystem): feature real products/images in articles.

Two entire subsystems (article **Improvements** and **Product Catalog**) are absent from
our schema. Deferred: baseline only needs enough prefs to generate one article.

### G3 — `audience.target` should be a list
Baseline `audience.target: z.string()` (single). Outrank collects **up to 7 target-audience
segments**. Change to `z.array(z.string()).max(7)` when we expand.

### G4 — Competitors: no minimum, not collected at scan
Baseline `audience.competitors: z.array(z.string())` has no `.min()`, and `start_scan`
doesn't gather competitors. Outrank **requires ≥3** (blocks Continue) and enriches keyword
research from them. Add a `.min(3)` (and a max, e.g. 7) when competitor-driven keywords land.

### G5 — `internal_links` is a boolean, should be a count
Baseline `content_seo.internal_links: z.boolean()`. Outrank stores "N links per article"
(e.g. 3) and gates it on a sitemap being present. Widen to an integer count later.

### G6 — `business.description` is a flat string
Baseline `business.description: z.string()`. Outrank's is **structured rich text** (H2s +
bullet lists: features / advantages / problems solved). A flat string flattens that
structure. Consider markdown/rich-text if description drives article context.

### G7 — No Google Search Console hook
Outrank offers "Connect GSC" (Blog step + dashboard) to avoid suggesting keywords you
already rank for. No analog in ours. Deferred with G1-style integrations.

### G8 — Persistence cadence (design choice, not a bug)
Outrank **saves per step** (toast after each), enabling resumable partial onboarding. Our
baseline does a single `PATCH /setup/presets` then `POST /setup/finalize`. Revisit only if
we want resume-mid-onboarding.

### G9 — Nothing past `setup_complete`
On finish, Outrank immediately generates a keyword/content **plan** onto a scheduler
calendar (analyze site + competitors, pick keywords by volume/difficulty, schedule a
month of articles). Our dashboard is currently a minimal mock; there is no
content-planning surface yet. Out of scope for onboarding baseline; noted for dashboard work.

## Non-gaps (deliberately out of scope)
- **Discovery / "How did you hear about us?"** — marketing attribution, not product data.
  Correctly absent from `SetupPresetsSchema`.
- **Upsell/trial/subscription modals** — billing UX, orthogonal to onboarding data model.
