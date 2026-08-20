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
Integration**) map onto our wizard. The preset steps use the four `SetupPresetsSchema`
top-level keys; Integration reads and writes the separate generalized integration entity.

## Gap backlog (deferred, prioritized)

### G1 — Integrations / publishing model *(completed for self-hosted WordPress)*
Outrank's Integration step connects a CMS to auto-publish articles (WordPress, Notion,
Webflow, Shopify, Wix, WordPress.com, API Webhook, Framer, Ghost, Next.js Blog, Feather).
Our generalized `integrations` entity stores verified WordPress and static-site connections.
The optional onboarding step reuses `GET /dashboard/integrations/connected` and
`POST /dashboard/integrations/wordpress`, so it does not duplicate those operations under
`/setup`. Static-site/GitHub onboarding remains deferred because its external redirect needs
the unfinished wizard state and callback destination to be restored.

### G2 — `article_preferences` is a thin subset (8 of ~24 controls)
Current: `content_seo.{article_style, internal_links_count, table_of_contents,
llm_instructions}` + `engagement.{image_style, youtube_videos, include_cta}` +
`publishing.auto_publish`. The CTA preference is enforced across outline, article,
humanization, and final semantic validation; disabling it also clears any CTA returned in the
outline.
Outrank additionally exposes, on the Articles step:
- **Content/SEO:** external-link count, outline controls, and excluded words.
- **Engagement toggles:** brand color; Title-Based Featured Image (+ its own style);
  Infographics; Emojis; Mention Similar Products & Tools; First-Person Writing; custom AI
  image-style presets.
- **Improvement Schedule** and **Product Catalog** are no longer planned.

The remaining gap is optional article-generation polish, not a baseline blocker.

**Confirmed 2026-07-01:** the live `output_settings_presets` row has ~24 controls (full field
list in [`product-flow.md`](product-flow.md) §2.3); ours implements 8 of them.

### G3 — `audience.target` should be a list
Baseline `audience.target: z.string()` (single). Outrank collects **up to 7 target-audience
segments**. Change to `z.array(z.string()).max(7)` when we expand. **Confirmed 2026-07-01:**
the live `products.target_audiences` held **5** segments, and each generated keyword's
`generation_filters.target_audiences.{all,selected}` drives which segment produced it — so the
list isn't cosmetic, it's a generation input.

### G4 — Competitors: no minimum, not collected at scan
Baseline `audience.competitors: z.array(z.string())` has no `.min()`, and `start_scan`
doesn't gather competitors. Outrank **requires ≥3** (blocks Continue) and enriches keyword
research from them. Add a `.min(3)` (and a max, e.g. 7) when competitor-driven keywords land.
**Confirmed 2026-07-01:** ~half the generated keywords had `generation_source: "competitors"`
with `generation_context` naming the exact rival (super.so / potion.so / simple.ink) — competitors
are a direct keyword-generation input, not just stored metadata.

### G5 — `internal_links` is a boolean, should be a count
Baseline `content_seo.internal_links: z.boolean()`. Outrank stores "N links per article"
(e.g. 3) and gates it on a sitemap being present. Widen to an integer count later.
**Confirmed 2026-07-01:** live `output_settings_presets.internal_links: 3` (plus a separate
`external_links_count: 3`).

### G10 — No article-classification layer on keywords
Baseline treats a scheduled keyword as ~a string + volume/difficulty. Outrank pre-types every
keyword into *what article it becomes*: `article_type` (`guide`/`listicle`/…),
`article_subtype` (`howTo`/`resources`/`roundup`/…), `type_metadata`
`{ contentFocus, expectedLength, visualElements[] }`, and `type_confidence`. This brief is
carried from research → schedule → generation. Deferred; add when the keyword→article worker lands.

### G11 — No E-E-A-T "quality questions" on keywords
Each Outrank keyword carries `quality_questions[]` `{ id, question, answer }` — first-person
interview prompts the author fills in to inject real experience into the article (Google
E-E-A-T signal). No analog in ours. Deferred with G10.

### G12 — Article generation prefs are a single blob, not named presets
Our `article_preferences` is one object on the org. Outrank's `output_settings_presets` is a
**named, per-product** row (`name: "Default"`) — multiple presets per site, selectable per
article/batch. Revisit if per-batch style switching is wanted; baseline's single blob is fine.

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
