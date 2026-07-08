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
  images get edge caching. Objects are immutable at a given key (retries overwrite
  *before* the URL is stored), so long TTLs need no invalidation story.
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

1. `ImageClient.generate` (fal, FLUX.1 [dev] default). Cover targets **1200×630**: the
   neutral `ImageGenerateParams.size` union gains a `{ width, height }` variant (fal's
   `image_size` accepts custom dimensions natively). Inline images use
   `landscape_16_9`.
2. Fetch the returned image bytes from the fal URL.
3. Upload to the stage bucket at a **deterministic key**:
   `articles/{article_id}/{cover|inline-1|inline-2}.{ext}`. Deterministic keys make
   retries overwrite-idempotent — no orphaned or duplicate assets.
4. Store `https://<distribution-domain>/<key>` on the slot, with `model`, `seed`,
   `generated_at`.

> **Decide before prod:** stored URLs bake in the CloudFront domain. If we want a
> custom domain (e.g. `img.seopotion.com`), alias it onto the distribution **before**
> real articles exist, or accept the default `*.cloudfront.net` domain permanently.

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
3. For each slot without a `url`: generate → download → S3 → update slot (+ inject
   markdown for inline).
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
| fal.ai API key | `FAL_KEY` in root `.env` (+ `.env.example`) | per-stage SSM SecureString via `FAL_KEY_PARAM`, granted **only to the images worker Lambda** |

CDK (`api-stack.ts`), per stage:

- `ImagesQueue` + `ImagesDlq` (`maxReceiveCount: 3`, visibility timeout ≥ worker
  timeout — image generation is slow, size generously).
- `ImagesWorkerFn` (`NodejsFunction`, entry `apps/worker/src/images.ts`) + SQS event
  source (`batchSize: 1`); granted Mongo URI param, `FAL_KEY` param, `OPENROUTER_API_KEY`
  param (for the plan call), and `putObject` on the bucket.
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
  idempotency + deterministic S3 keys + SQS redelivery.
- Article unpublished until image policy satisfied — `images_status` gate invariant
  for the future publisher.
