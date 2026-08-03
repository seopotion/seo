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
| Encoding | **WebP at store time** — re-encoded + downscaled in the worker before the S3 put, so every consumer (CDN, WordPress, git) gets the same small bytes |
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
3. **Re-encode to WebP and downscale** — see [Encoding](#encoding-webp--downscale).
4. Upload to the stage bucket at a **deterministic key**:
   `articles/{article_id}/{cover|inline-1|inline-2}.webp`. Deterministic keys make
   retries overwrite-idempotent — no orphaned or duplicate assets.
5. Store `https://<distribution-domain>/<key>` on the slot, with `model`, `seed`,
   `generated_at`.

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

## Encoding: WebP + downscale

The provider's bytes are stored unmodified today — a 1200×630 FLUX PNG is 1.5–2.5 MB.
Across ~50 articles at 4 images each that is ~400 MB of PNG versus ~24 MB of WebP.

The original argument was that this is fatal in git, because the static-site integration
committed images into the client's repo and git history is permanent. **That integration
now leaves images on our CDN** ([`static-site-integration.md`](static-site-integration.md),
revised 2026-07-30), so the git argument is gone — and the case is, if anything, stronger
without it. Those URLs render on *someone else's* pages now: a 2 MB PNG cover is the
client's Largest Contentful Paint, on a page we sold them as an SEO asset, and we pay the
egress for every view of it. What was a one-time storage cost is now a recurring
performance and bandwidth cost that scales with their traffic.

**Where: between the fetch and the S3 put**, in the images worker — the only point in
the system where the bytes are already in memory. The alternatives are both worse:

- *At publish time (API Lambda).* Re-converts on every republish and once per target,
  needs a re-download, and puts a native module in the request-path Lambda. It also
  leaves the dashboard preview, `og:image` and the WordPress path still shipping
  full-size PNG — the problem was never git-specific, which is why the design outlived
  the git argument that first motivated it.
- *Ask the provider for WebP.* `ImageGenerateParams` has no format field, fal's support
  would need re-verifying per model, and it yields no control over quality or
  dimensions — which is most of the win.

Converting at store time means there is exactly **one copy of the bytes** and every
consumer — dashboard, `og:image`, WordPress, and a client's static site linking straight to
CloudFront — gets the same small file. The API Lambda never needs sharp.

| Slot | Resize | Encode |
| --- | --- | --- |
| cover | `1200×630`, `fit: 'cover'` | WebP `quality: 80` |
| inline | max width `1200`, `withoutEnlargement` | WebP `quality: 80` |

The cover is already *requested* at 1200×630, but FLUX snaps to model-friendly
dimensions — the resize is what actually guarantees the OG aspect ratio. Metadata is
stripped (sharp's default): smaller files, and no provider EXIF served from our CDN. `slotKey`'s extension becomes a constant `webp` and `storeImage` gets
`ContentType: image/webp`, so the content-type-sniffing branch in the worker disappears.

### Packaging sharp on Lambda

sharp ships **platform-specific native binaries** (`@img/sharp-linux-x64` and friends).
`NodejsFunction` local bundling runs `npm install` on the *developer's* machine, so a Mac
would ship a `darwin-arm64` binary to a `linux-x64` Lambda and the function would throw
on import. The fix is a **second bundling object for the images worker only** — the
shared `bundling` const backs every Lambda in the stack and must not grow a native dep:

```ts
// Images worker only: sharp is native, so it stays external and is installed
// inside the Lambda build image. Docker bundling is what makes the binary
// linux-x64 rather than the build host's platform.
const imageBundling = { ...bundling, nodeModules: ['sharp'], forceDockerBundling: true };
```

plus `sharp` in [`apps/worker/package.json`](../apps/worker/package.json) `dependencies`
— CDK resolves the version from the package.json nearest the entry, and the root
`package-lock.json` is already wired in as `depsLockFilePath`.

Consequences, all accepted:

- **`cdk synth` / `deploy` now needs Docker running**, for the whole stack, since the
  function lives in it. The repo already requires Docker for local infra
  (`docker compose up -d`) and the deploy workflow runs on `ubuntu-latest`, which has
  it. Worth a check in `cli infra preflight`, which already gates deploys.
- **`architecture` is unset, so it is `X86_64`** — not arm64. CDK derives the Docker
  build platform from it, giving a correct but emulated (slow) build on Apple Silicon.
  Moving *this* Lambda to `ARM64` would make local builds native and the function ~20%
  cheaper; a separate call, not required here.
- **`memorySize` 512 → 1024.** Lambda scales vCPU with memory and WebP encoding is
  CPU-bound, so the work finishes proportionally faster at roughly flat GB-ms cost. The
  10-minute timeout is untouched and generous.
- **Local dev is unaffected** — `npm run dev -w worker` runs under tsx against the host's
  own sharp binary.

If Docker-at-synth ever becomes unacceptable, the fallback is a **prebuilt Lambda layer**
from its own CI job: it removes the synth-time Docker requirement and adds an artifact to
build, version and publish. More moving parts, so not the first choice.

**Existing articles are not touched.** They are `images_status: 'complete'`, so the worker
skips them and their `.png` keys stay valid. A backfill would also have to rewrite the
URLs already embedded in `article.content`; out of scope until something needs it.

### Recorded dimensions

sharp hands back the final `width` / `height` for free, so both are stored on the slot:

```ts
// article.ts — ArticleImageSchema
width: z.number().nullable(),
height: z.number().nullable(),
```

**Nullable, not required.** Repositories `parse` through Zod at the boundary, so every
article generated before this lands would fail to *load* if the fields were mandatory —
this is a read-path break, not just a write-path one. They follow `model` / `seed` /
`generated_at`, already nullable for the same unfilled-slot reason.

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
3. For each slot without a `url`: generate → download → **re-encode to WebP** → S3 →
   update slot (+ inject markdown for inline).
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
  idempotency + deterministic S3 keys + SQS redelivery.
- Article unpublished until image policy satisfied — `images_status` gate invariant
  for the future publisher.
