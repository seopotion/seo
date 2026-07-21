# Article YouTube Video Embedding

**Status:** decided. Design for issue [#85](https://github.com/seopotion/seo/issues/85).
Builds on the generation pipeline (#55) and mirrors the enrichment patterns from
[`article-images.md`](article-images.md) (#51). This doc records the design; the
implementation plan is separate.

The product behavior (from Outrank parity, [`product-flow.md`](product-flow.md) §2.2/§2.3):
each generated article gets **one auto-sourced, relevant embedded YouTube video**,
controlled by an engagement toggle (`is_video_included` in their preset; ours below).
The pricing page already markets "Relevant YouTube videos" on both plans.

## Decisions

| Concern | Choice |
| --- | --- |
| Video source | **YouTube Data API v3** `search.list` (free 10,000 units/day quota; a search costs 100 units → ~100 searches/day; no paid tier — over-quota degrades gracefully, see below) |
| Pipeline shape | **Inline in the generation worker**, between validation success and `ArticleRepo.create` — no new queue/worker. One HTTP GET + one cheap LLM call; failure is non-fatal |
| Selection | **LLM picks from top ~10** embeddable results (or picks none), and chooses the H2 section the embed follows — mirrors the image-plan pattern |
| Representation | **Structured `video` field on the Article** (`video_id`, `title`, `section_heading`) **plus an `<iframe>` injected into `content`** after the chosen H2 — content is self-contained for any renderer; the future publisher (#7) never parses iframes back out |
| Settings | `article_preferences.engagement.include_youtube_video: boolean`, **`.default(true)`** in `SetupPresetsSchema` — existing docs parse unchanged; editable via existing `PATCH /setup/presets`; scanner untouched |
| Failure state | **No status enum.** `video: null` means "no video" — whether toggle-off, no relevant result, quota exhaustion, or provider error. No retry/backfill machinery |

## Why this shape

- **Inline, not a queue:** unlike images (multi-slot, minutes of provider work, S3
  writes), this is one search request and one small LLM call. A third queue + DLQ +
  Lambda + CDK wiring buys retry semantics we deliberately don't want — a missing
  video should never delay or fail an article. Running pre-persist also means the
  iframe lands in `content` at create time; no post-create content update.
- **LLM pick, not top result:** YouTube relevance for niche SEO keywords is
  hit-or-miss, and there must be a "nothing fits, embed nothing" escape hatch. The
  pick call also chooses the target H2, exactly like the image plan chooses
  `section_heading`s.
- **Structured field + injected markup:** the dashboard renderer and any CMS get a
  working embed from `content` alone, while the publisher and future editors get the
  video as data. One field, no parsing.
- **YouTube Data API v3, not DataForSEO:** decided by maintainer. Costs a new
  provider + key, but the API is free within quota and first-party. There is **no
  paid tier**; beyond 10k units/day the only path is Google's free quota-extension
  audit (days–weeks) — easier to pass with a live product, deferred until volume
  demands it.

## Schema changes (`@shared/schemas`)

```ts
// article.ts
const ArticleVideoSchema = z.object({
  video_id: z.string(),          // YouTube video id
  title: z.string(),             // video title (also the iframe title attr)
  section_heading: z.string(),   // exact H2 text the embed follows
});

// Added to ArticleSchema, defaulted so pre-#85 docs still parse:
video: ArticleVideoSchema.nullable().default(null),
```

```ts
// presets.ts — engagement gains a second field:
engagement: z.object({
  image_style: z.string(),
  include_youtube_video: z.boolean().default(true),
}),
```

- `video` is exposed on the article API responses (they derive from the shared
  schema), so the frontend/publisher consume it structurally.
- Default-on matches Outrank (engagement toggles default on) and the pricing page.

## Provider (`@shared/providers/src/youtube/`)

`createYouTubeClient({ apiKey })` with one method, shaped like the DataForSEO client
(plain `fetch`, normalized results, typed errors):

```ts
searchVideos(query: string, opts?: { max?: number; relevanceLanguage?: string })
  : Promise<YouTubeVideo[]>
// YouTubeVideo: { video_id, title, description, channel }
```

Calls `GET https://www.googleapis.com/youtube/v3/search` with `part=snippet`,
`type=video`, `videoEmbeddable=true`, `maxResults` (default 10), `q=<keyword>`, and
`relevanceLanguage` when derivable — `presets.business.language` is a free-form
string, so map it to an ISO 639-1 code best-effort and **omit the param when
unmappable** (the API requires a code). Key comes from a **`YOUTUBE_API_KEY`
env var on the generation worker Lambda** — same pattern as `FAL_KEY` /
`OPENROUTER_API_KEY` (CDK wiring; staging/prod value provisioning is the usual
manual step, #9/#43 bucket).

## Generation helpers (`@shared/generation/src/video.ts`)

Mirrors `images.ts`:

- `buildVideoPickPrompt({ articleTitle, metaDescription, headings, candidates })` →
  LLM messages asking for JSON `{ video_index: number | null, section_heading: string }`,
  with explicit permission to return `null` when no candidate is relevant.
- `parseVideoPick(text, candidateCount, headings)` — validates index in range and
  heading exactly matches, like `parseImagePlan`.
- `buildVideoEmbed(videoId, title)` → standard privacy-enhanced iframe:
  `https://www.youtube-nocookie.com/embed/<id>` with `title`, `allowfullscreen`,
  and standard `allow` attrs.
- Injection reuses the heading-splice logic — generalize `injectImageAfterHeading`
  into an inject-block-after-heading helper both call sites share.

## Worker flow (`apps/worker/src/generation.ts`)

Between validation success and `ArticleRepo.create`:

1. If `org.presets.article_preferences.engagement.include_youtube_video` is false →
   skip entirely (no quota spent).
2. `searchVideos(keyword.keyword, { relevanceLanguage })` → empty → skip.
3. LLM pick → `null` → skip.
4. Inject iframe into `result.article.content` after the chosen H2; set `video` on
   the create input.

The whole step is wrapped in `try/catch`: any error (quota 403, network, bad LLM
output) logs and continues without a video — same spirit as the image-enqueue catch.
The article is **never** failed, delayed, or redelivered over the video step.

## Cost / quota posture

One `search.list` (100 units) + one small LLM call per article with the toggle on.
Free quota therefore caps at ~100 video-enriched articles/day **globally** (one
shared API key). Over quota, articles simply ship with `video: null`. Deliberately
deferred (YAGNI until volume demands): per-keyword search caching, quota-extension
application, retry/backfill for videoless articles.

## Testing

- **Provider:** mocked `fetch` — query params (embeddable, max, language),
  normalization, non-2xx → typed error.
- **`video.ts`:** prompt shape; pick parsing (valid, `null`, out-of-range index,
  unknown heading → throw); embed markup; injection after the right H2.
- **Generation worker** (mocked clients, existing test style): happy path persists
  `video` + iframe in content; toggle off → no search call; search/LLM error →
  article persists with `video: null`; LLM picks `null` → same.

## Out of scope

Frontend toggle wiring (frontend epic #19/#20 — the API supports it via
`PATCH /setup/presets`), CMS publishing behavior (#7), keyword-level caching,
quota extension, backfilling existing articles.
