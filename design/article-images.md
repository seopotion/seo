# Article Cover & Inline Images

**Status:** decided. Design for issue [#51](https://github.com/seopotion/seo/issues/51)
(Phase 4 of the article-pipeline epic [#56](https://github.com/seopotion/seo/issues/56)).
Builds on the provider decision in [`llm-image-providers.md`](llm-image-providers.md) (#52)
and the generation pipeline (#55). This doc records the design; the implementation plan
is separate.

## Decisions

| Concern | Choice |
| --- | --- |
| Pipeline shape | Separate **image SQS task** (`ImageTask`), enqueued by the generation worker after the article persists; consumed by a new images worker Lambda |
| Durable storage | **One private S3 bucket per stage** + **CloudFront distribution** (Origin Access Control); article URLs are CloudFront URLs |
| Encoding | **WebP from the provider** — fal is asked for `output_format: 'webp'` at the requested pixel size, so the bytes are already small when they arrive and every consumer (CDN, WordPress, git) gets the same file. Revised 2026-08-04, [#178](https://github.com/seopotion/seo/issues/178) |
| Image policy | **Cover (1200×630) + 2 inline images, all required** for `images_status: 'complete'`; inline count is a config constant |
| Placement | Inline images **injected into `article.content` markdown** directly after their target `## heading`; cover stays out of content (`featured_image_url` + metadata) |
| Image state | **Embedded on the Article document** (`images` array + `images_status`), no new collection |

## Why this shape

- **Separate SQS task:** the generation worker's claim machine (`claimGeneration`)
  intentionally blocks re-entry once an article exists, so image failures could never
  retry through the generation path. A dedicated `ImageTask{org_id, article_id}` on its
  own queue (+ DLQ, `maxReceiveCount: 3`) gets retries from SQS redelivery for free,
  never re-runs text generation, and mirrors the existing scan/strategy/generation
  one-queue-per-task-type pattern (one `Queue` + one `NodejsFunction` handler each).
- **Per-stage bucket, not shared:** the whole stack is stage-parameterized (per-stage
  SSM, queues, Lambdas). A shared bucket would need cross-stack wiring and would mix
  staging and prod assets in one namespace.
- **CloudFront + OAC, not public-read:** the bucket needs no public access policy;
  images get edge caching. Objects are immutable at a given key (the key carries a
  digest of its own bytes), so long TTLs need no invalidation story.
- **Embedded image state:** an article's images are small, bounded (3), and never
  queried independently — a separate collection would add a repo and indexes with no
  query need.

## Schema changes (`@shared/schemas`)

```ts
// article.ts
const ArticleImageSchema = z.object({
  role: z.enum(['cover', 'inline']),
  section_heading: z.string().nullable(), // null for cover; exact H2 text for inline
  prompt: z.string(),
  alt: z.string(),
  url: z.string(),                        // '' until generated (CloudFront URL after)
  model: z.string().nullable(),
  seed: z.number().nullable(),
  generated_at: z.date().nullable(),
  width: z.number().nullable().default(null),   // intrinsic pixels, from fal (#176)
  height: z.number().nullable().default(null),
});

// Added to ArticleSchema, defaulted so pre-#51 docs still parse:
images: z.array(ArticleImageSchema).default([]),
images_status: z.enum(['pending', 'complete', 'failed']).default('pending'),
```

- `featured_image_url` stays and is set to the cover's CloudFront URL when it lands —
  existing consumers keep working unchanged.
- New `ImageTask` Zod schema (`org_id`, `article_id`) alongside `ScanTask` /
  `GenerateTask`; the API/worker build it, the images worker validates with
  `ImageTask.parse` on read.

## Image plan (structured prompts + alt text)

New module in `@shared/generation`. One LLM call (`responseFormat: 'json'`) takes the
validated article (title, meta description, H2 headings extracted from `content`) plus
org context, and returns:

- cover: `{ prompt, alt }` — purpose: OG/social + article top; placement is the
  renderer's job.
- inline × `INLINE_IMAGE_COUNT` (config constant, default **2**): `{ prompt, alt,
  section_heading }`.

Deterministic validation rejects a plan whose `section_heading` doesn't exactly match
an H2 present in the content — this is what makes placement reference **stable,
explicit sections** rather than arbitrary markdown positions. Every image must have
non-empty `alt`.

The plan is persisted onto `article.images` as pending slots **only if `images` is
empty** (atomic set-if-absent in the repo). A retry therefore never re-plans and never
changes slot identity.

## Generation, storage, URLs

For each slot without a `url`:

1. `ImageClient.generate` (fal, FLUX.1 [dev] default), asking for
   **`outputFormat: 'webp'`** — see [Encoding](#encoding-webp-from-the-provider). Both
   roles target exact pixels via the `{ width, height }` variant of the neutral
   `ImageGenerateParams.size` union (fal's `image_size` accepts custom dimensions
   natively): **1200×630** cover, **1200×675** inline.
2. Fetch the returned image bytes from the fal URL — already WebP, so nothing is
   re-encoded and no PNG is ever downloaded or stored.
3. Reject the image unless fal reported a positive integer `width` **and** `height`.
   They are published as `<img width height>` (#176), so a wrong value reserves the
   wrong box on the client's page — worse than shipping none. Throwing here means
   nothing is uploaded or persisted and SQS redelivers.
4. Upload to the stage bucket at a **content-addressed key**:
   `articles/{article_id}/{cover|inline-N}-{sha256(bytes)}.webp`, with a one-year
   immutable `Cache-Control` — see [Object keys](#object-keys-content-addressed).
5. Store `https://<distribution-domain>/<key>` on the slot, with `model`, `seed`,
   `generated_at`, and the `width` / `height` fal reported.

> **Decide before prod — and this got sharper on 2026-07-30.** Stored URLs bake in the
> CloudFront domain. If we want a custom domain (e.g. `img.seopotion.com`), alias it onto
> the distribution **before** real articles exist, or accept the default
> `*.cloudfront.net` domain permanently.
>
> The static-site integration now leaves images on the CDN and commits the absolute URL
> into the client's repo, so these strings escape our systems entirely: they land in
> someone else's **permanent git history** and render on their live pages. Changing the
> domain afterwards is no longer a database migration — it is a rewrite-and-republish
> across every customer repository, and a period of 404s on published articles for anyone
> who does not accept the republish. A raw `d1234.cloudfront.net` also reads as
> third-party junk in a client's `git diff`, which is a bad first impression for a feature
> whose pitch is "auditable". **Alias the domain before the first static-site install.**

## Encoding: WebP from the provider

**Revised 2026-08-04 ([#178](https://github.com/seopotion/seo/issues/178)).** The section
below previously specified a local `sharp` re-encode in the worker. It no longer does —
fal encodes WebP itself, which removes a native dependency, a Docker-at-synth
requirement and a whole class of Lambda packaging risk. The original reasoning for
*why* small bytes matter is unchanged and kept.

The provider's bytes were stored unmodified — a 1200×630 FLUX PNG is 1.1–2.5 MB.
Across ~50 articles at 4 images each that is ~400 MB of PNG versus ~24 MB of WebP.

The original argument was that this is fatal in git, because the static-site integration
committed images into the client's repo and git history is permanent. **That integration
now leaves images on our CDN** ([`static-site-integration.md`](static-site-integration.md),
revised 2026-07-30), so the git argument is gone — and the case is, if anything, stronger
without it. Those URLs render on *someone else's* pages now: a 2 MB PNG cover is the
client's Largest Contentful Paint, on a page we sold them as an SEO asset, and we pay the
egress for every view of it. What was a one-time storage cost is now a recurring
performance and bandwidth cost that scales with their traffic.

### Ask the provider, don't re-encode

`fal-ai/flux-2` takes an `output_format` of `jpeg | png | webp` (default `png`) —
verified against fal's published schema for the endpoint on 2026-08-04:

```
GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-2
  → Flux2Input.output_format = { enum: ["jpeg", "png", "webp"], default: "png" }
```

So the whole conversion is one field on the generate call, and the worker downloads
~70 KB from fal instead of ~1.1 MB — generation gets *faster* as a side effect. There is
exactly one copy of the bytes and every consumer (dashboard, `og:image`, WordPress, a
client's static site linking straight to CloudFront) gets the same small file.

| Slot | Requested size | Encode |
| --- | --- | --- |
| cover | `1200×630` (OG large-card) | fal `output_format: 'webp'` |
| inline | `1200×675` (same 1200px cap, 16:9) | fal `output_format: 'webp'` |

Inline images request **exact pixels** rather than the `landscape_16_9` preset, because
the preset is the model's choice and can exceed the 1200px cap. `slotKey`'s extension is
`webp` and `storeImage` gets `ContentType: image/webp`. The content-type branch in the
worker survives as a small map — it is what keeps the stored key honest (`.png` stays
`.png`) rather than mislabelling the bytes if the provider ever answers with a format we
did not ask for. Each store logs `bytes` + `content_type` + dimensions, because fal picks
the quality: the byte budget (cover ~80 KB, cap 150 KB; inline ~60 KB, cap 100 KB) is the
acceptance criterion, so it has to stay measurable in production.

**Accepted tradeoff:** fal owns the quality knob, so we cannot enforce the byte caps
deterministically or retry at a lower quality on overflow. If real generations turn out to
overshoot, a local encode is the fallback — see below for what that costs.

**No `sharp`, no Lambda packaging change.** The rejected local-encode path needed
`nodeModules: ['sharp']` + `forceDockerBundling` on a second bundling object (the shared
`bundling` const backs *every* Lambda and must not grow a native dep), which would have
made `cdk synth`/`deploy` require Docker for the whole stack, or a prebuilt layer with its
own CI job. `memorySize` stays 512 MB — nothing CPU-bound happens in the worker now.

**Existing articles are not touched.** They are `images_status: 'complete'`, so the worker
skips them and their `.png` keys stay valid — which also means published URLs never move,
so the orphaning risk in [#177](https://github.com/seopotion/seo/issues/177) never
arises. A backfill would have to rewrite the URLs already embedded in `article.content`
and already committed to client repos; out of scope until something needs it.

### Cache headers

`storeImage` sets `CacheControl: 'public, max-age=31536000, immutable'`. These URLs are
committed verbatim into client repos, so a repeat visitor should never revalidate;
without it CloudFront falls back to its default TTL.

### Object keys: content-addressed

The key is `articles/{article_id}/{cover|inline-N}-{sha256(bytes)}.webp`, digested from
the exact bytes uploaded. **A slot key alone is not safe to serve `immutable`.** The S3
put happens *before* the guarded `fillImageSlot`, so two concurrent deliveries for one
slot both write, last-put-wins, and the delivery that wins the database guard can end up
describing bytes the loser overwrote — persisting `width`/`height` that do not match the
object, cached for a year on someone else's page. Content-addressing gives each distinct
image its own object, so a URL's bytes can never change under it.

This also *strengthens* the permanence guarantee [#177](https://github.com/seopotion/seo/issues/177)
was closed on: an object is never overwritten or moved, so a URL already committed to a
client repo cannot be invalidated by a later regenerate.

**The tradeoff, accepted:** the original deterministic-key design (#51) claimed "retries
overwrite — no orphaned or duplicate assets", and that is now inverted. Generation is
non-deterministic (no fixed seed), so a retry that regenerates after a successful put but
before a successful fill leaves the earlier object behind forever, and the bucket has no
lifecycle rule. The objects are ~70KB and the path is rare, so this is cheap — but it is
unbounded, and a sweep of objects no slot references is the fix if it ever matters.

### Losing a fill race

`fillImageSlot` is guarded on the slot still being empty, so exactly one concurrent
delivery wins. The loser must **not** carry its own image forward: it reloads the article
and adopts the persisted URL and content, because publishing its own URL would publish
one the article never recorded, and building the next inline injection on its local
content would inject a second copy of the image. Completion reloads for the same reason —
the cover URL handed to `completeImages` is the persisted one, never the local view.

### Recorded dimensions

fal returns the final `width` / `height` on every image it produces, and we were already
parsing them into `ImageResult` and throwing them away. Both are now stored on the slot
(closing [#176](https://github.com/seopotion/seo/issues/176)) — and the *returned* size is
what gets stored, not the requested one, because FLUX snaps to model-friendly multiples.

```ts
// article.ts — ArticleImageSchema
width: z.number().nullable().default(null),
height: z.number().nullable().default(null),
```

**Nullable and defaulted, not required.** Repositories `parse` through Zod at the
boundary, so every article generated before this landed would fail to *load* if the
fields were mandatory — a read-path break, not just a write-path one. They follow
`model` / `seed` / `generated_at`, already nullable for the same unfilled-slot reason.

They flow into the static-site contract's manifest and frontmatter so an adapter can set
explicit `width`/`height` on `<img>` and reserve the space before the image loads.
CLS is a ranking signal, which makes it our problem and not only the client's. Consumers
that ignore the fields are unaffected, so the contract stays `version: 1`.

## Placement

When an inline slot's image lands, insert `![alt](url)` into `article.content`
immediately after its `## section_heading` line. Slot update and content injection
happen together, and injection fires only on the pending→generated transition, so SQS
redeliveries cannot double-insert. The cover is not injected into content.

## Images worker (`apps/worker/src/images.ts`)

Per SQS record:

1. `ImageTask.parse` → load article; skip if missing or `images_status === 'complete'`.
2. If `images` is empty: run the image-plan LLM call, validate, persist slots
   (set-if-absent).
3. For each slot without a `url`: generate (**WebP**) → download → S3 → update slot with
   the URL and fal's dimensions (+ inject markdown for inline).
4. All slots done → `images_status: 'complete'`, `featured_image_url` = cover URL.
5. On error: log, rethrow → SQS redelivery resumes at the first unfinished slot → DLQ
   after 3 receives → `images_status` left `'pending'` (visible for ops; a manual
   re-enqueue resumes idempotently). A plan that repeatedly fails validation marks
   `images_status: 'failed'`.

The generation worker (`generation.ts`) changes only at the end: after
`ArticleRepo.create` + `linkArticle`, enqueue `ImageTask`.

## Publish gate

Publishing isn't built yet; articles already stay `generated`. The gate is the
invariant — **the future publisher must require `images_status === 'complete'`** —
recorded here and on the field's schema comment. No enforcement code beyond the field.

## Secrets, config, infra

Picks up the wiring [#52 deferred](llm-image-providers.md#configuration--secrets):

| Item | Local | Deployed |
| --- | --- | --- |
| fal.ai API key | `FAL_KEY` in root `.env` (+ `.env.example`) | synth-time env (`FAL_KEY`), matching the existing provider-secret pattern; per-stage SSM SecureString provisioning is deferred with the rest (#9/#43) |

CDK (`api-stack.ts`), per stage:

- `ImagesQueue` + `ImagesDlq` (`maxReceiveCount: 3`, visibility timeout ≥ worker
  timeout — image generation is slow, size generously).
- `ImagesWorkerFn` (`NodejsFunction`, entry `apps/worker/src/images.ts`) + SQS event
  source (`batchSize: 1`); granted the Mongo URI SSM param, `FAL_KEY` and
  `OPENROUTER_API_KEY` as synth-time env vars (for the plan call), and `putObject` on
  the bucket.
- Private S3 `ImagesBucket` + CloudFront `Distribution` with
  `S3BucketOrigin.withOriginAccessControl`; long default TTL.
- `GenerationWorkerFn` gains `IMAGES_QUEUE_URL` + send permission.

Local dev: new ElasticMQ queue, `IMAGES_QUEUE_URL` env, one more poller line in
`dev.ts`. Locally, S3 upload needs real AWS credentials or a local substitute — the
worker takes the bucket/distribution config from env (`IMAGES_BUCKET`,
`IMAGES_CDN_DOMAIN`); when unset, local dev stores the raw fal URL instead of
uploading (dev-only fallback, clearly logged).

## Cost

Unchanged from the [#52 estimate](llm-image-providers.md#cost-per-article-estimate):
~3 images ≈ $0.08–0.15 per article, plus one small LLM plan call. S3/CloudFront cost
is negligible at this volume.

## Testing

- Unit (Vitest, mocked clients/repos per existing convention): image-plan prompt
  builder + JSON parse (including rejecting unknown headings / empty alt); markdown
  injection (placement correctness + double-run idempotency); images handler
  (partial-failure resume, plan set-if-absent, completion transition, skip-if-complete).
- Integration: `ArticleRepo` slot-update methods against real Mongo.
- Gates: `npm run lint`, `npm run check:all`, `npm test` stay green.

## Acceptance-criteria mapping (#51)

- Every successful article has a cover + configured inline images — worker loop +
  `images_status: 'complete'` transition.
- Every image has meaningful alt text — plan schema requires non-empty `alt`;
  injected as `![alt](url)`.
- Inline placement references stable article sections — plan validated against actual
  H2s; injection anchored to the heading line.
- Partial failures retryable without regenerating successful assets — per-slot
  idempotency + content-addressed S3 keys + SQS redelivery.
- Article unpublished until image policy satisfied — `images_status` gate invariant
  for the future publisher.
