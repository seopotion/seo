# Documentation — Coverage Gaps & Information Architecture

Research + planning doc. **No code changes and no doc pages were written for this.** It answers two
questions: *what are we not documenting that we should be?* and *how should `/docs` be split into
pages?*

> **Status — 2026-07-26: decisions locked, implementation not started.** All eight open choices are
> settled in Part 3. Build order is Part 4. Start there if you're picking this up to implement.

Supersedes the earlier `documentation-pages.md` scoping plan (2026-07-25, never committed). Its
still-current parts — the product framing and the live-vs-hold inventory — are carried into §0.1
below; its proposed section list is replaced by §1.5 and §2.5, and its two open decisions are
answered (priority tiers in §1.5; docs ship bilingual en + tr, §2.6).

---

## 0. Method & what was verified

Read first: [`apps/web/app/[locale]/(marketing)/docs/page.tsx`](../apps/web/app/%5Blocale%5D/%28marketing%29/docs/page.tsx),
the `DocsPage` namespace in [`apps/web/messages/en.json`](../apps/web/messages/en.json) / `tr.json`,
the superseded `documentation-pages.md`, [`PROGRESS.md`](../PROGRESS.md),
[`product-flow.md`](product-flow.md), and the live product message namespaces (`Onboarding`,
`SettingsPage`, `ArticleSettingsPage`, `ContentPlannerPage`, `ContentHistoryPage`,
`ArticleDetailPage`, `HomePage`, `BillingPage`, `PricingPage`) — the last group is the most reliable
inventory of what a user can actually click today.

Competitor structure was fetched live. **Verified:** Outrank, Surfer, Frase. **Not verified — do not
cite:** Jasper (`help.jasper.ai` returns 403 to automated fetches) and Writesonic
(`help.writesonic.com` root returns 404; only deep-linked collection URLs resolve). No claims below
rest on either.

**Baseline size:** our entire docs page is **825 words of body copy across 13 topics** (mean 47 words
per topic). Outrank's *single* WordPress integration page is ~2,000 words. That ratio — our whole
site at 40% of one competitor page — is the finding that frames everything else.

## 0.1 What the product is, and what we're allowed to document

*Carried over from the superseded `documentation-pages.md`; re-checked against
[`PROGRESS.md`](../PROGRESS.md) on 2026-07-26.*

**The product, in one line:** an **AI SEO content engine** — connect your site → it scans and builds
a business profile → keyword research → a 30-day content plan → auto-writes articles (outline →
write → humanize → validate) with cover/inline images and YouTube embeds → publishes to WordPress.
Plus Google Search Console insights and billing (free / paid / expert).

**Live — safe to document as working:** onboarding/website scan, business profile & presets, keyword
research + candidate pool (paid), content planner, article generation, images, YouTube embedding,
content history + editor, WordPress publishing, Google Search Console + Home cards, billing, i18n
(en/tr).

**Hold — do NOT document as available** (roadmap page only): Ads, Analytics, Backlinks, Article
Improvements (placeholder pages); Domain Rating (backend-only, not in UI); hosted-CMS integrations
(Notion, Webflow, Shopify, …); auto-publish on generation. Multi-org switching shipped (#127, `docs/superpowers/specs/2026-09-05-org-switcher-design.md`) — its docs page is a follow-up.

> **Amended 2026-08-08.** The hold above used to read "non-WordPress integrations", which now
> over-reaches: the **custom site (GitHub)** integration shipped (#7, `static-site-integration.md`)
> and is documented at `/docs/custom-site`. Only the *hosted-CMS* members of that group are still
> unbuilt. The hold list is written from what ships, so re-check it against the product before
> citing it — a stale hold blocks documenting something real just as effectively as a stale "live"
> entry ships a lie.

Two amendments from this review's cross-check: **auto-publish** belongs on the hold list *even
though its toggle is visible and persists* (§1.4.3), and marketing copy currently promises several
held items (§1.4.4). Check every new page against this list before writing it.

---

# Part 1 — Coverage gap analysis

## 1.1 What we cover today

Shipped: 6 groups / 13 topics, one scrolling page with a sticky sidebar, content stored in the
`DocsPage` i18n namespace (en + tr structurally identical — same 6 groups, same 13 `id`s).

| Group | Topic (`id`) | Words | Substance |
| --- | --- | ---: | --- |
| Getting started | `overview` | 79 | Value prop + 4 bullets |
| | `how-it-works` | 60 | Scan → Plan → Generate → Publish |
| | `quickstart` | 57 | 5 steps, sign-up to first article |
| Setup & onboarding | `connect-website` | 60 | URL scan, 5–10 min, editable |
| | `business-profile` | 73 | Name/language/country, description, audience, blog settings |
| | `article-preferences` | 52 | Content & SEO / Engagement, two lines |
| Content | `keyword-research` | 35 | Candidate pool exists, paid |
| | `content-planner` | 35 | "30-day plan, topic clusters" |
| | `article-generation` | 58 | outline → draft → humanize → validation |
| | `content-history` | 29 | Articles land here, editor exists |
| Publishing | `wordpress` | 44 | Install plugin, connect, publish/update |
| Insights | `search-console` | 30 | Authorize, pick property, Home cards |
| Account | `billing` | 34 | free/paid/expert, portal, promo codes |
| | `language` | 27 | en/tr switcher |
| — | `roadmap` (callout) | 42 | Held features named in one paragraph |

Against the original scoping plan (§0.1's source), **six planned
topics were never written**: *Signing in*, *Plans at a glance*, *Editing your presets later*, *FAQ*,
*SEO glossary*, *Troubleshooting*. *Changelog* was also planned and skipped. The shipped page is the
plan's §1–§6 compressed, with §7 (Reference & Support) dropped entirely.

## 1.2 Competitor structures (verified)

### Outrank — closest peer, deliberately thin docs

- **No docs index.** `https://www.outrank.so/docs` returns **404**; docs are reachable only from the
  site footer's "Documentation" column. Flat URLs: `/docs/<slug>`.
- **8 doc surfaces, and 7 of them are integrations or API:** [WordPress](https://www.outrank.so/docs/wordpress),
  [Webhook](https://www.outrank.so/docs/webhook), [Framer](https://www.outrank.so/docs/framer),
  [Shopify](https://www.outrank.so/docs/shopify), Ghost, Next.js Blog,
  [REST API](https://www.outrank.so/docs/api), CLI for AI Agents (npm), plus one feature guide,
  [Improvements](https://www.outrank.so/docs/improvements).
- **Depth per page is high.** The WordPress page (~2,000 words) runs: 4-step install → *what gets
  published* (7 elements) → *publishing options* (auto-publish / draft / scheduled) → **6-item
  troubleshooting list with literal error messages** → security & best practices. The API page
  (~1,200–1,500 words) is a full reference: key setup, base URL, auth, quickstart curl, **rate
  limits (120/min, 10k/day)**, endpoints grouped by resource (Auth, Products, Keywords, Articles,
  GSC, Billing), error codes, agent usage.
- **Getting started / billing / concepts are not in docs at all** — they live in marketing pages
  ("How it works", "Writing Examples", "Pricing") and the blog. Their docs are a *post-purchase
  integration manual*, not a help center.

### Surfer — full Intercom-style help center ([docs.surferseo.com](https://docs.surferseo.com/en/))

- **9 top-level collections:** Surfer step-by-step, Pricing/Account & Subscription, Workspaces,
  Content Editor, SEO Tools, AI Visibility, More tools, Integrations & API, Other.
- **Two-level nesting** (collection → sub-collection → article). Sizes sampled:
  [Surfer step-by-step](https://docs.surferseo.com/en/collections/12929937-surfer-step-by-step) = 24
  articles in 5 sub-collections; [Integrations & API](https://docs.surferseo.com/en/collections/3932030-integrations-and-api)
  = 22 articles in 6 sub-collections; [Pricing, Account & Subscription](https://docs.surferseo.com/en/collections/3203190-pricing-account-and-subscription)
  = 11 articles + 4 sub-collections.
- **Granularity is one article per task**, titled as a numbered step in a workflow: "Step 0: How to
  setup Google Search Console (GSC)", "Step 1: How to add Google Search Console to Surfer", "Step 2:
  How to setup Sites and audit your website", "Step 3: How to fix your existing content". A single
  onboarding job is split across four short pages rather than one long one.
- **Troubleshooting is first-class *and* per-feature**: "WordPress Plugin Troubleshooting", "Surfer
  API Troubleshooting", "Google Docs Extension Troubleshooting", "Keyword Surfer Extension
  Troubleshooting", plus a Troubleshooting sub-collection under
  [Other](https://docs.surferseo.com/en/collections/3203191-other).
- **Billing is first-class**: cancel, what happens after cancel, downgrade, invoices, failed
  payments, accepted payment methods, trial mechanics, usage & limits, fair-use policy — one article
  each.
- **Concept explainers are first-class**: "Surfer Language & Location Support", "In-Depth Look at
  Content Score", "NLP", "Article Lifecycle - 3 Easy Steps". No formal glossary page; concepts get
  their own articles instead.

### Frase — the best size-match for us ([help.frase.io](https://help.frase.io/))

- **7 categories, 49 articles total** — roughly 7 per category. This is what "proportional" looks
  like for a product our size.
- Categories are named after **workflow stages, not product nouns**: Frase 101: Learn the Basics (7),
  Research & Outline (6), Draft Faster with AI (11), Optimize for SEO & GEO (5), Organize &
  Collaborate (7), Integrations & API (5), Account & Billing (8).
- Every category carries a one-line "who is this for" subtitle on the index — the index page does
  routing work, not just listing.

### Cross-competitor pattern

All three treat **integrations** and **account/billing** as first-class. Two of three (Surfer,
Frase) treat **API** as first-class; Outrank makes it the centerpiece. Two of three ship a
**getting-started track**; Outrank pushes that to marketing. **None** ships a glossary as a page —
they write per-concept explainers instead. **None** exposes a changelog inside docs.

## 1.3 Coverage matrix

| Topic area | Seopotion today | Outrank | Surfer | Frase | Verdict |
| --- | --- | --- | --- | --- | --- |
| Getting started / what is this | 3 topics, 196 w | in marketing | 5 articles | 7 articles | **Thin but present** |
| Concept: how the pipeline works | 60 w | Improvements guide | Article Lifecycle, NLP | category intros | **Gap — no depth** |
| Onboarding / connect site | 60 w | — | 4-step track | 6 articles | **Gap** |
| Business profile / brand voice | 73 w | — | Workspaces collection | Organize (7) | **Gap** |
| Article/output settings | 52 w | in integration docs | Content Editor collection | Draft Faster (11) | **Gap — biggest per-word deficit** |
| Keyword research | 35 w | via API/product | SEO Tools + More tools | Research & Outline (6) | **Gap** |
| Planning / calendar | 35 w | — | Content plan track (3) | — | **Gap** |
| Generation pipeline & expectations | 58 w | Improvements | Surfer AI article | Draft Faster | **Gap** |
| Editing content | 29 w | — | Content Editor (own collection) | Draft Faster | **Gap** |
| **Publishing integration (WP)** | 44 w | **~2,000 w page** | 7 articles | Integrations (5) | **Worst gap vs. peers** |
| Other CMS integrations | roadmap line | 6 more pages | Contentful, GDocs | in Integrations | **[later]** — unbuilt |
| Search Console | 30 w | in Improvements | 5+ articles incl. "why connect" | — | **Gap** |
| Dashboard / Home reading | none | — | "Surfer Dashboard Explained" | — | **Gap** |
| Plans: what each unlocks | 34 w (generic) | Pricing page | "Which plan to choose?" | Account & Billing | **Gap** |
| Billing ops (cancel, invoice, fail) | none | — | 11 articles + 4 sub | 8 articles | **Gap** |
| **Troubleshooting** | **none** | per-integration | per-feature + collection | in-category | **Gap — universal, we have zero** |
| **FAQ / support contact** | **none** | FAQ inside guides | Pricing FAQ, Migration FAQ | — | **Gap** |
| Language / locale support | 27 w (UI only) | 150+ languages claim | "Language & Location Support" | — | **Partial — wrong axis** |
| Glossary | none | none | concept articles | none | **Low priority — nobody does it** |
| API / webhooks | none | centerpiece | 5 articles | 5 articles | **[later]** — unbuilt |
| Changelog | none | none | none | none | **Skip** |

## 1.4 Accuracy defects in what's already written

Found while cross-checking the docs against the shipped UI. These matter more than any new page —
a wrong doc is worse than a missing one.

1. **"30-day plan" vs. a 45-day calendar — resolved 2026-07-26.** The planning horizon is **always
   30 days**; the calendar renders **45 days** purely so users can see the upcoming empty dates.
   Docs should state the 30-day plan and explain the 45-day view as forward visibility, not capacity.
   **Also a product copy bug:** `ContentPlannerPage.description` currently reads *"Plan one article
   per day across the next 45 days"*, which asserts the wrong horizon — worth fixing in the UI
   (en + tr) at the same time.
2. **Quickstart implies free users get a content plan.** Step 4 is *"Finish onboarding to generate
   your content plan"*, but the planner is gated on `capabilities.keyword_research` /
   `keyword_scheduling`
   ([content-planner/page.tsx:50-51](../apps/web/app/%5Blocale%5D/%28authenticated%29/%28product%29/content-planner/page.tsx#L50-L51)),
   and Billing's own copy is *"Unlock keyword research and scheduling by upgrading"*. The documented
   happy path is the **paid** path and doesn't say so.
3. **Auto-publish is a live toggle that does nothing.** Article Settings renders and persists an
   Auto-publish switch
   ([article-settings/page.tsx:271-275](../apps/web/app/%5Blocale%5D/%28authenticated%29/%28product%29/article-settings/page.tsx#L271-L275)
   → `article_preferences.publishing.auto_publish`), but publish-on-generation is unbuilt
   ([#53](https://github.com/seopotion/seo/issues/53), needs [#7](https://github.com/seopotion/seo/issues/7)).
   Docs correctly omit it — which means a user who flips it has no way to learn it's inert.
   **Resolved 2026-07-26: fixing the control is in scope for this work** (§4) — gate or label it
   "coming soon". Docs still must not describe it as working.
4. **Marketing claims exceed documented reality.** The pricing page's comparison table and FAQ
   promise *"CMS publishing integrations"*, *"connections to WordPress, Webflow, and more"*,
   *"Unlimited users"*, *"Unlimited AI rewrites"*, and *"Backlink opportunity review"*; the landing
   page adds *"Quality Backlink Building"* and *"AI Search Optimization"*. Shipped: WordPress only,
   no multi-user/org switching ([#127](https://github.com/seopotion/seo/issues/127)), no backlinks,
   no rewrites feature. Docs are the surface where that gap gets discovered. Not a docs bug to fix
   silently — **surface it**; docs should describe only WordPress and the roadmap page should hold
   the rest.
5. **Scan timing is asserted, not verified.** "About 5–10 minutes" appears twice. `start_scan` is
   still 🟡 in PROGRESS ("schema-valid empty presets persisted until backend real-data scan APIs are
   connected"). Verify against real worker behaviour before repeating a number users will time.

## 1.5 Prioritized gaps

Ordered by (user pain × how live the feature is). `[now]` = feature is shipped, write it.
`[later]` = blocked on unbuilt work; roadmap line only.

**Tier 1 — write with the split**

1. **`[now]` WordPress publishing, in full.** Plugin install, token connect, publish vs. update,
   what fields transfer, the warning/error states the UI already surfaces (`wordpress.pluginError`,
   `wordpress.warnings`, `wordpress.requestError`), and a troubleshooting list. Our 44 words vs.
   Outrank's ~2,000 on the same integration is the single largest competitive deficit.
2. **`[now]` Troubleshooting.** Zero coverage; universal among peers. Seed from error strings
   already in the message files: scan failures, `checkScanStatus`, `generatedDetailsPending`, GSC
   `reconnectNeeded`/`statusError`, WordPress plugin errors, planner scheduling conflicts
   (`date_occupied`, `candidate_already_scheduled`), generation failures (Home's
   `recommended.actions.generationFailed`, `strategyFailed`).
3. **`[now]` Scheduling a keyword onto a date.** The candidate chooser is a real, interactive paid
   feature — volume, difficulty, intent, opportunity score columns, conflict handling, "Research
   keywords" — and docs never mention that manual scheduling exists at all.
4. **`[now]` What each plan unlocks.** Currently one generic sentence. Users need free vs. Growth vs.
   Expert-led Growth mapped to capabilities. **Caveat:** the frontend cannot currently distinguish
   paid from expert (both map to `capabilities.keyword_research` —
   [#131](https://github.com/seopotion/seo/issues/131)), so describe tiers by *entitlement*, not by
   UI behaviour.
5. **`[now]` Signing in.** Planned, never written. Google-only, why, what a session is, and the
   known rough edge (JWT in localStorage, no refresh — [#18](https://github.com/seopotion/seo/issues/18))
   phrased as "you may be asked to sign in again".
6. **`[now]` Article settings, field by field.** Article style options, internal links **0–3**,
   table of contents (undocumented), image style, YouTube toggle. Omit auto-publish (see §1.4.3).

**Tier 2 — next pass**

7. **`[now]` Reading your Home dashboard.** Recommended Actions, Articles planned/published counts,
   Best Articles, Search Performance, and what each gated state means. Surfer ships "Surfer Dashboard
   Explained" for exactly this.
8. **`[now]` Google Search Console, properly.** Why connect, the read-only scope (the product
   already promises *"only reads your Search Console data"*), property picker, the 28-day window,
   reconnect/disconnect, what re-locks on disconnect.
9. **`[now]` Article lifecycle & statuses.** `generated` / `published` / `deleted`, what "published"
   means (sent to WordPress ≠ live edit), slug, keyword linkage, where edits are saved.
10. **`[now]` Generation cadence & expectations.** Daily schedule, ~30 articles/month per pricing,
    what happens when a generation fails, why articles appear over time rather than at once.
11. **`[now]` Support & contact.** `support@seopotion.co` is only surfaced on the "Coming soon"
    placeholder. Docs must say how to get a human.
12. **`[now]` Language & region — on the right axis.** Today we document only the UI switcher. The
    load-bearing part is *content* language + country as search market (business profile), which is
    what Surfer dedicates an article to.
13. **`[now]` Onboarding steps we skip.** Blog Info (sitemap URL, blog page URL, best-3 posts) and
    Integrations & referral source are real wizard steps; docs fold the first into a bullet and
    ignore the second.
14. **`[now]` Editing presets later.** Planned, never written. Cheap: a short "everything is editable
    from Settings / Article Settings" page with a map of which setting lives where.
15. **`[now]` FAQ.** Pricing already has one; docs have none. Cheap to seed from sales questions.

**Tier 3 — write only if the audience asks**

16. **`[now]` Glossary.** Genuinely useful for an SMB/Turkish audience, but **no verified competitor
    ships one** — they write per-concept explainers instead. Recommend: skip the standalone glossary,
    define terms inline where they first appear.
17. **`[later]` Public API / webhooks** — unbuilt. Worth noting that all three competitors treat this
    as first-class; when we build it, it's a docs anchor, not an afterthought.
18. **`[later]` Auto-publish on generation** — [#53](https://github.com/seopotion/seo/issues/53).
19. **`[later]` Other CMS integrations** (Webflow, Shopify, Ghost, Framer, Notion) — [#7](https://github.com/seopotion/seo/issues/7).
20. **`[later]` Article Improvements** — placeholder page; Outrank documents theirs as a full feature
    guide, so this is a competitive parity item once built.
21. **`[later]` Analytics, Backlinks, Ads, Domain Rating, multi-org/teams** — roadmap page only.
22. **`[later]` AI-search / GEO visibility.** Surfer has an entire AI Visibility collection and our
    own landing page claims "AI Search Optimization" — nothing is built. Roadmap only, and see
    §1.4.4.
23. **Skip: changelog.** No verified competitor ships one in docs; it needs a process we don't have.

---

# Part 2 — Information architecture

## 2.1 The shape, in one paragraph

Split into a `/docs` index plus **flat one-level guide routes `/docs/<slug>`** — categories live in
navigation metadata, never in the URL, and slugs are **identical across locales**. Drive sidebar,
index cards, breadcrumbs, prev/next, `generateStaticParams`, and `sitemap.ts` from **one ordered
registry module**. Move prose out of the i18n message bundle into **per-locale MDX files**
(`@next/mdx`, no content-layer dependency), keeping next-intl for UI chrome. A missing Turkish page
**fails the build**. Ship 12 pages written to real depth, with per-locale screenshots, then add the
Tier-1 gaps.

## 2.2 Route structure

```
/docs                      → index (server component)
/docs/<slug>               → one guide per page
/tr/docs, /tr/docs/<slug>  → same, via localePrefix: 'as-needed'
```

Files:

```
app/[locale]/(marketing)/docs/
  layout.tsx          # sidebar shell (exists — currently metadata only)
  page.tsx            # index
  [slug]/page.tsx     # guide: generateStaticParams over locales × slugs
  registry.ts         # ordered nav tree — single source of truth
```

**Flat, not nested (`/docs/getting-started/quickstart`).** Reasons, in order of weight:

1. **Our categories will churn.** Five placeholder features (Analytics, Backlinks, Ads, Article
   Improvements, more CMS integrations) are coming. Under nesting, every regroup is a URL change and
   a redirect we maintain forever. Under flat, regrouping is a one-line edit in `registry.ts`.
2. **Deep links from the product stay stable.** The highest-value docs traffic will be
   "Learn more →" links next to settings and error states. Those must never rot.
3. **Our closest peer is flat** (`outrank.so/docs/wordpress`) and it costs them nothing.

Nesting's real benefit is hierarchy signalling for SEO — we get that from breadcrumb JSON-LD built
off `registry.ts`, without paying in URL stability.

**i18n:** nothing new is needed. `localizedPath` / `languageAlternates` in
[`apps/web/i18n/urls.ts`](../apps/web/i18n/urls.ts) are already path-generic, so
`languageAlternates('/docs/wordpress')` works as-is. The existing `generateMetadata` pattern in
[`docs/layout.tsx`](../apps/web/app/%5Blocale%5D/%28marketing%29/docs/layout.tsx) moves to
`[slug]/page.tsx` with per-page title/description.

## 2.3 The granularity rule

> **One page = one job a user can finish in one sitting, with one dominant search intent.**

Operationally, a topic **earns its own page** when any of these is true:

- It is a **task with a completion state** ("connect WordPress", "connect Search Console") — these
  attract standalone search traffic and need their own troubleshooting tail.
- It is the **target of a deep link from the product** (an error message, a settings panel, a gated
  card).
- It needs **more than ~400 words**, or step-by-step ordering with screenshots.
- It has a **distinct failure mode** worth a troubleshooting section. (This is Surfer's tell: every
  integration article has a matching troubleshooting article.)

It stays a **section within a page** when:

- It's only meaningful as part of a larger task (Blog Info is a step of the business profile, not a
  destination).
- It's a **definition or concept** with no action attached — inline it where the term first appears.
- Splitting it would leave a page under ~150 words. A 47-word page is a dead end; today **every one
  of our 13 topics** is under that line, which is why "split the current page 1:1 into 13 pages"
  would be the wrong move — the split must come with the depth increase from §1.5.

**Corollary that matters for us:** don't split `overview` and `how-it-works` into pages. They're the
index.

## 2.4 Navigation model

**Worth building now:**

- **Index page that routes rather than lists.** Grouped cards with a one-line "who this is for"
  subtitle each — Frase's index does exactly this and it's the cheapest way to make 12 pages
  navigable.
- **Persistent grouped sidebar** in `docs/layout.tsx`. We already have the group structure; it moves
  from anchors to links. Highlight by pathname instead of the current `IntersectionObserver`, which
  deletes that whole effect.
- **Breadcrumbs** (`Docs → <Group> → <Page>`) + `BreadcrumbList` JSON-LD. Nearly free from
  `registry.ts`, and it restores the hierarchy signal that flat URLs give up.
- **Prev/next** in registry order. Our docs are a linear product story (scan → plan → generate →
  publish); prev/next is the cheapest completion driver.

**Premature at our size:**

- **Search.** Under ~25 pages the sidebar plus browser find is enough. Revisit at ~40 pages, and
  then prefer a build-time client-side index over a hosted service.
- **Per-page feedback widgets, versioning, contributor/edit-on-GitHub links, a docs-only nav bar.**
- **Video embeds / MasterClass-style tracks** (Surfer has these; they're a content investment, not
  an IA one).

**Deliberately not a docs page:** the roadmap. Keep it as a single `/docs/roadmap` page (promoted out
of the current inline amber callout) so held features have exactly one home and never get mistaken
for documented behaviour.

## 2.5 Proposed sitemap

**Phase 1 — the split (12 pages, migrates today's content + fixes §1.4):**

| Route | Group | Purpose |
| --- | --- | --- |
| `/docs` | — | What Seopotion is, the four-stage loop, and where to go next |
| `/docs/quickstart` | Getting started | Sign-up to first article, with the free/paid fork made explicit |
| `/docs/connect-your-website` | Setup | The URL scan: what we read, what it produces, how long |
| `/docs/business-profile` | Setup | Name/language/country, description, audience, competitors, blog info |
| `/docs/article-settings` | Setup | Every output preference, field by field |
| `/docs/keyword-research` | Content | Research, the candidate pool, and the metrics on it (paid) |
| `/docs/content-planner` | Content | Calendar, clusters, and scheduling a keyword onto a date |
| `/docs/article-generation` | Content | Pipeline, cadence, images, video, what failure looks like |
| `/docs/content-history` | Content | Finding articles, statuses, and the editor |
| `/docs/wordpress` | Publishing | Install → connect → publish/update → troubleshooting |
| `/docs/google-search-console` | Insights | Connect, property, scope, what it unlocks |
| `/docs/billing` | Account | Plans, what each unlocks, portal, promo codes |
| `/docs/roadmap` | — | Held features, stated as not-yet-available |

**Phase 2 — Tier-1/2 gaps (7 pages):** `/docs/signing-in`, `/docs/plans` (split out of billing once
[#131](https://github.com/seopotion/seo/issues/131) lands), `/docs/home-dashboard`,
`/docs/troubleshooting`, `/docs/faq`, `/docs/language-and-region`, `/docs/managing-your-settings`.

That lands at **19–20 pages** — between Frase's 49 and Outrank's 8, appropriate for our surface area.

## 2.6 Content format: MDX (decided)

Prose moves to **per-locale MDX files compiled by `@next/mdx`** — no content-layer dependency
(`content-collections`, `velite`) and no docs framework (Fumadocs). next-intl keeps everything that
isn't prose: nav labels, group titles, breadcrumb and prev/next chrome, index card copy.

Why MDX at all, strongest first:

1. **The current renderer can't express the content we need.** `DocsPage` items support exactly
   `body` / `bullets` / `note`. The WordPress page needs numbered steps, screenshots, a token/code
   block, and a troubleshooting table. Extending the JSON block-renderer to cover that is building a
   worse MDX.
2. **Message-bundle cost is paid site-wide.** Measured 2026-07-26: `messages/en.json` is **41.0 KB**
   (tr 45.1 KB), of which `DocsPage` is **6.4 KB (16%)**; gzipped the whole bundle is ~11.9 KB. And
   [`app/[locale]/layout.tsx`](../apps/web/app/%5Blocale%5D/layout.tsx) renders
   `<NextIntlClientProvider>` **without an explicit `messages` prop**, so the whole bundle is
   serialized on every route. Moving today's docs out saves only ~6 KB raw / ~2 KB gzipped — the
   real point is what it *prevents*: 20 pages at competitor depth is ~12,000 words (80–100 KB),
   which would roughly triple what every page carries.
3. **Prose in JSON is hostile to whoever writes the Turkish.** Escaped quotes, no line breaks, no
   diffable paragraphs.

**Orthogonal fix, do it anyway:** pass an explicit `messages` subset to `NextIntlClientProvider`.
It's independent of MDX and cuts the payload on every route today.

### File layout & frontmatter

```
content/docs/
  en/wordpress.mdx
  tr/wordpress.mdx
```

Locale-as-directory (not `wordpress.tr.mdx`) so a whole locale can be diffed, globbed, or handed to
a translator, and a third language is one `mkdir` plus a `routing.locales` entry.

Frontmatter per file — `title`, `description`, `updated`. Structure (`group`, `order`) lives in
`registry.ts`, **not** in frontmatter, so nav order can't diverge between locales.

### Resolution in the route

```tsx
const { locale, slug } = await params;
const { default: Body, frontmatter } = await import(`@/content/docs/${locale}/${slug}.mdx`);
```

`generateStaticParams` returns `routing.locales × registry slugs`, so every page prerenders. The
template-literal dynamic import is the standard pattern but makes the bundler build a context of all
matching files — **spike this first under Next 16 / Turbopack** (§4, step 1). Fallback if it
misbehaves: a build-time generated import map. This is the only genuinely unproven piece of the plan.

### Slugs: identical across locales

`/docs/wordpress` and `/tr/docs/wordpress`. One registry, and
`languageAlternates('/docs/wordpress')` keeps working untouched. Localized Turkish slugs
(`/tr/docs/wordpress-yayinlama`) would read better for Turkish organic search and next-intl supports
it via `pathnames` — revisit if Turkish organic traffic becomes a priority; it's a contained change.

### Missing translations fail the build

No English fallback, no hiding pages from the Turkish nav. A Vitest case asserts the `en` and `tr`
file sets are identical, that every file parses, and that required frontmatter keys are present.
~20 lines, and it replaces the structural parity next-intl gave us for free. Consequence to accept:
**an English page cannot merge without its Turkish counterpart.**

## 2.7 Screenshots & assets

Screenshots are in scope from Phase 1, **per-locale everywhere** — Turkish pages show Turkish UI.
The product is fully localized, so English screenshots under Turkish prose would be a visible
quality smell, and on click-along flows (onboarding, WordPress connect, GSC connect) they'd actively
mislead.

Costs to plan for, stated plainly: **every screenshot exists twice, and every UI change invalidates
both.** The frontend is still the active frontier, so expect churn.

- Store under `public/docs/<slug>/<name>.<locale>.png`, referenced from MDX via `next/image`.
- Shoot at a fixed viewport width so pages don't jitter between images; always pass explicit
  `width`/`height`.
- The parity test should also assert that a `.tr.png` exists for every `.en.png`, so a half-localized
  page can't merge.
- Cheapest churn control: prefer screenshots of **things that rarely move** (the WordPress plugin
  screen, Google's OAuth consent, the GSC property picker) over our own fast-changing panels; use
  prose for the rest.

## 2.8 Migration mapping

| Today (anchor on one page) | Becomes | Note |
| --- | --- | --- |
| `#overview` + `#how-it-works` | `/docs` index | Merge; the index is the concept page |
| `#quickstart` | `/docs/quickstart` | **Fix §1.4.2** — say which steps need a paid plan |
| `#connect-website` | `/docs/connect-your-website` | Verify the 5–10 min claim (§1.4.5) |
| `#business-profile` | `/docs/business-profile` | Absorb the Blog Info onboarding step |
| `#article-preferences` | `/docs/article-settings` | Expand to per-field; auto-publish only once the control is gated/labelled (§4) |
| `#keyword-research` | `/docs/keyword-research` | Add candidate-pool metrics |
| `#content-planner` | `/docs/content-planner` | 30-day plan, 45-day calendar view (§1.4.1); add scheduling |
| `#article-generation` | `/docs/article-generation` | Add cadence + failure states |
| `#content-history` | `/docs/content-history` | Add statuses + editor detail |
| `#wordpress` | `/docs/wordpress` | Tier-1 rewrite, ~10× current length |
| `#search-console` | `/docs/google-search-console` | Add scope, 28-day window, disconnect |
| `#billing` | `/docs/billing` | Add per-tier entitlements |
| `#language` | fold into `/docs/billing` now → `/docs/language-and-region` in Phase 2 | 27 words can't stand alone (§2.3) |
| roadmap callout | `/docs/roadmap` | Promote out of the amber box |

**Migration is free right now.** The docs route is **untracked in git** and the `/docs` sitemap entry
is uncommitted — nothing is deployed, indexed, or linked externally, so there are **no redirects to
write**. That reverses if we ship the single page first. *This is the argument for doing the split
before the next deploy, not after.*

**Sitemap:** [`app/sitemap.ts`](../apps/web/app/sitemap.ts) currently hardcodes `publicPaths` with a
single `/docs` entry and a global `lastModified` of `2026-07-01`. Change: import the registry and
spread `docs.map(d => ({ path: '/docs/' + d.slug, changeFrequency: 'monthly', priority: 0.6 }))`.
The existing `flatMap` over `routing.locales` plus `languageAlternates` then produces correct
`hreflang` for every page with no other change. Two follow-ups worth doing at the same time: give
docs entries a **real per-page `lastModified`** (from MDX frontmatter or file mtime — a fixed date
across a growing docs site is a weak signal), and keep `/docs` itself at priority 0.7 as the hub.

**i18n sync discipline:** en and tr are structurally identical today and must stay that way. With
the registry as the source of truth for slugs and the parity test for files, a missing Turkish page
fails CI instead of shipping a 404 to half the audience.

---

# Part 3 — Decisions (locked 2026-07-26)

| # | Decision | Choice | Where |
| --- | --- | --- | --- |
| 1 | Planning horizon | **30-day plan**; the calendar renders 45 days for forward visibility only | §1.4.1 |
| 2 | Content format | **MDX**, per-locale files | §2.6 |
| 3 | MDX toolchain | **`@next/mdx` only** — no content layer, no docs framework | §2.6 |
| 4 | Slugs | **Identical across locales** (`/docs/wordpress`, `/tr/docs/wordpress`) | §2.6 |
| 5 | Missing Turkish page | **Fail the build** — no English fallback, no hiding from TR nav | §2.6 |
| 6 | Screenshots | **In scope from Phase 1**, and **per-locale everywhere** | §2.7 |
| 7 | Rollout | **Plumbing + 3 exemplar pages first**, then one PR per group | §4 |
| 8 | Turkish authoring | **Claude drafts EN + TR**; Alper reviews TR for tone/terminology before merge | §4 |
| 9 | Product copy bugs | **In scope** — planner's 45-day string and the inert auto-publish toggle get fixed | §1.4.3, §4 |

Still deliberately **not** decided (and not blocking): whether to reconcile the pricing/landing
claims that outrun the product (§1.4.4). Docs will describe WordPress only and route the rest to
`/docs/roadmap`; the marketing copy itself is left untouched pending your call.

---

# Part 4 — Build order

**PR 1 — plumbing + exemplars.** The one PR that proves the system end to end:

1. **Spike the MDX import pattern first** (§2.6) before writing any content — it's the only unproven
   piece, and everything else depends on its shape.
2. `@next/mdx` + `mdx-components.tsx`, `content/docs/{en,tr}/`, `registry.ts`.
3. Routes: `/docs` index, `/docs/[slug]`, sidebar in `layout.tsx`, breadcrumbs, prev/next.
4. `sitemap.ts` driven by the registry, with per-page `lastModified` from frontmatter (§2.8).
5. Parity test: en/tr file sets, frontmatter keys, screenshot pairs.
6. Explicit `messages` subset on `NextIntlClientProvider` (§2.6, orthogonal but cheap here).
7. Three pages at full depth, EN + TR: **`/docs/wordpress`** (the biggest competitive gap),
   **`/docs/quickstart`** (fixes the free/paid fork, §1.4.2), **`/docs/content-planner`** (fixes the
   30/45-day confusion, §1.4.1).
8. Delete the old single-page `DocsPage` renderer and its i18n namespace.

**PR 2 — product copy fixes** (decision 9, independent of the docs and reviewable in minutes):
correct `ContentPlannerPage.description` in en + tr, and gate or label the auto-publish toggle.
Land this early so the docs never describe a self-contradicting product.

**PRs 3–5 — the rest of Phase 1, one per group:** Setup (`connect-your-website`,
`business-profile`, `article-settings`) · Content (`keyword-research`, `article-generation`,
`content-history`) · Account & meta (`google-search-console`, `billing`, `roadmap`, index polish).

**Phase 2 — the seven gap pages** from §2.5, in Tier order from §1.5. `/docs/plans` waits on
[#131](https://github.com/seopotion/seo/issues/131) (the FE can't distinguish paid from expert yet).

**Gates, every PR:** `npm run lint`, `npm run check:all`, `npm test`. Turkish review by Alper is a
merge gate on any PR containing content.

## Sources

Competitor structure fetched 2026-07-26.

- Outrank docs (no index — `/docs` returns 404): [WordPress](https://www.outrank.so/docs/wordpress) ·
  [REST API](https://www.outrank.so/docs/api) · [Improvements](https://www.outrank.so/docs/improvements) ·
  [Webhook](https://www.outrank.so/docs/webhook) · [Framer](https://www.outrank.so/docs/framer) ·
  [Shopify](https://www.outrank.so/docs/shopify) · footer index at [outrank.so](https://www.outrank.so/)
- Surfer: [help center home](https://docs.surferseo.com/en/) ·
  [Surfer step-by-step](https://docs.surferseo.com/en/collections/12929937-surfer-step-by-step) ·
  [Integrations & API](https://docs.surferseo.com/en/collections/3932030-integrations-and-api) ·
  [Pricing, Account & Subscription](https://docs.surferseo.com/en/collections/3203190-pricing-account-and-subscription) ·
  [Other](https://docs.surferseo.com/en/collections/3203191-other) ·
  [What is Surfer?](https://docs.surferseo.com/en/articles/7859434-what-is-surfer)
- Frase: [help center home](https://help.frase.io/)
- **Unverified, not cited:** Jasper (`help.jasper.ai` → HTTP 403) and Writesonic
  (`help.writesonic.com` → HTTP 404). No claim above depends on either.
