# Article Cover & Inline Images (#51) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an article is generated (#55), a separate SQS-driven worker plans and generates a cover/OG image (1200×630) plus 2 inline images, stores them durably in a per-stage S3 bucket behind CloudFront, and attaches inline images to explicit article sections — with idempotent per-slot retries.

**Architecture:** The generation worker enqueues `ImageTask{org_id, article_id}` after persisting an article. A new images worker Lambda consumes it: one LLM call produces an image *plan* (prompts + alt + target H2 per inline image), persisted set-if-absent as pending slots on the Article document; each unfilled slot is then generated via fal.ai, uploaded to S3 at a deterministic key, and recorded (inline slots also inject `![alt](url)` into the markdown after their H2). All slots filled ⇒ `images_status: 'complete'` + `featured_image_url` = cover URL. Spec: `design/article-images.md`.

**Tech Stack:** TypeScript monorepo (npm workspaces), Zod 4, mongodb 7 driver, Hono/Lambda, SQS (+ ElasticMQ locally), `@aws-sdk/client-s3` (new worker dep), CDK (S3 + CloudFront + SQS + NodejsFunction), Vitest 4.

## Global Constraints

- Work on branch `faruk/article-images` (already exists, has the spec commit). PR into `dev`, never commit to `dev`/`master` directly.
- Biome style: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new files before committing.
- `verbatimModuleSyntax`: type-only imports MUST use `import type` / `export type`.
- Commit message prefix convention: `[schemas]` / `[providers]` / `[db]` / `[worker]` / `[infra]` / `[docs]`, suffix `(#51)`.
- Gates before claiming done: `npm run lint`, `npm run check:all`, `npm test`. Integration tests: `docker compose up -d mongo` then `npm run test:integration`.
- Run a single unit-test file by name filter: `npm test -- <filter>` (e.g. `npm test -- images`).
- Provider secrets are synth-time env vars in CDK (`process.env.X ?? ''`) — SSM SecureString provisioning is deferred repo-wide (#9/#43). `FAL_KEY` follows that existing pattern, NOT the spec's SSM row (Task 6 adds a spec note).
- Deterministic S3 keys: `articles/{article_id}/{cover|inline-1|inline-2}.{ext}` — retries overwrite, never duplicate.
- `INLINE_IMAGE_COUNT = 2` lives in `packages/shared/generation/src/config.ts`; cover size is `{ width: 1200, height: 630 }`.

---

### Task 1: Schemas — `ArticleImage`, `images`/`images_status` on Article, `ImageTask`

**Files:**
- Modify: `packages/shared/schemas/src/article.ts`
- Modify: `packages/shared/schemas/src/scan.ts`
- Test: `packages/shared/schemas/tests/article-images.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ArticleImageSchema` / `type ArticleImage` (`{ role: 'cover'|'inline', section_heading: string|null, prompt: string, alt: string, url: string, model: string|null, seed: number|null, generated_at: Date|null }`); `ArticleSchema` gains `images: ArticleImage[]` (default `[]`) and `images_status: 'pending'|'complete'|'failed'` (default `'pending'`); `CreateArticleInput` type becomes `z.input` (defaulted fields optional on create); `ImageTask` Zod schema + type `{ org_id: string, article_id: string }`. All re-exported via the package's existing `src/index.ts` barrel (no index change needed — it already re-exports `./article` and `./scan`).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schemas/tests/article-images.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { ArticleSchema, ImageTask } from '../src';

const baseDoc = {
  id: 'a1',
  org_id: 'o1',
  keyword_id: 'k1',
  title: 't',
  meta_title: 'mt',
  slug: 's',
  keyword: 'kw',
  meta_description: 'md',
  featured_image_url: '',
  content: '# c',
  difficulty: 1,
  search_volume: 2,
  status: 'generated',
  created_at: new Date(),
  published_at: null,
};

describe('article image fields (#51)', () => {
  test('pre-#51 documents parse with image defaults', () => {
    const a = ArticleSchema.parse(baseDoc);
    expect(a.images).toEqual([]);
    expect(a.images_status).toBe('pending');
  });

  test('image slots round-trip', () => {
    const a = ArticleSchema.parse({
      ...baseDoc,
      images: [
        {
          role: 'cover',
          section_heading: null,
          prompt: 'p',
          alt: 'alt',
          url: '',
          model: null,
          seed: null,
          generated_at: null,
        },
      ],
      images_status: 'pending',
    });
    expect(a.images[0]!.role).toBe('cover');
    expect(a.images[0]!.url).toBe('');
  });

  test('rejects an unknown images_status', () => {
    expect(() => ArticleSchema.parse({ ...baseDoc, images_status: 'nope' })).toThrow();
  });
});

describe('ImageTask', () => {
  test('validates the queue contract', () => {
    expect(ImageTask.parse({ org_id: 'o', article_id: 'a' })).toEqual({
      org_id: 'o',
      article_id: 'a',
    });
    expect(() => ImageTask.parse({ org_id: 'o' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- article-images`
Expected: FAIL — `ImageTask` is not exported / `images` not on parsed article.

- [ ] **Step 3: Implement the schema changes**

In `packages/shared/schemas/src/article.ts`, add above `ArticleSchema`:

```ts
/** Image slot roles + article-level image pipeline states (#51). */
export const ARTICLE_IMAGE_ROLES = ['cover', 'inline'] as const;
export const IMAGES_STATUSES = ['pending', 'complete', 'failed'] as const;

/**
 * One planned/generated image slot. `url` is '' until the image is generated
 * and stored (then it's our CloudFront URL); slots are created once by the
 * image plan and filled idempotently — see design/article-images.md.
 */
export const ArticleImageSchema = z.object({
  role: z.enum(ARTICLE_IMAGE_ROLES),
  // null for the cover; the exact H2 text the inline image attaches after.
  section_heading: z.string().nullable(),
  prompt: z.string(),
  alt: z.string(),
  url: z.string(),
  model: z.string().nullable(),
  seed: z.number().nullable(),
  generated_at: z.date().nullable(),
});
export type ArticleImage = z.infer<typeof ArticleImageSchema>;
```

Inside `ArticleSchema`, after `published_at`:

```ts
  // Image pipeline (#51). Defaulted so pre-#51 docs still parse. The future
  // publisher must require images_status === 'complete' before publishing.
  images: z.array(ArticleImageSchema).default([]),
  images_status: z.enum(IMAGES_STATUSES).default('pending'),
```

Change the `CreateArticleInput` **type** export from `z.infer` to `z.input` (same rationale as `CreateKeywordInput`):

```ts
/** Input for creating an article — the server assigns `id` and `created_at`. */
export const CreateArticleInput = ArticleSchema.omit({ id: true, created_at: true });
// `z.input` (not `z.infer`) so the defaulted image fields stay optional in the
// type, matching the runtime contract — same rationale as `CreateKeywordInput`.
export type CreateArticleInput = z.input<typeof CreateArticleInput>;
```

In `packages/shared/schemas/src/scan.ts`, append:

```ts
/**
 * Image task message — the contract on the SQS images queue between the
 * generation worker (producer, apps/worker/src/generation.ts) and the images
 * worker (consumer, apps/worker/src/images.ts). See #51.
 */
export const ImageTask = z.object({
  org_id: z.string(),
  article_id: z.string(),
});
export type ImageTask = z.infer<typeof ImageTask>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- article-images`
Expected: PASS (4 tests).

Run: `npm run check:all && npm test`
Expected: PASS — the `z.input` switch must not break existing consumers (`ArticleRepo.create`, dashboard routes, generation worker).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/schemas
git commit -m "[schemas] Article image slots + images_status + ImageTask (#51)"
```

---

### Task 2: Providers — custom `{width, height}` image size

**Files:**
- Modify: `packages/shared/providers/src/image/types.ts`
- Test: `packages/shared/providers/tests/image.test.ts` (extend)

**Interfaces:**
- Produces: `ImageGenerateParams.size` now accepts `ImageSize | { width: number; height: number }`. The fal client already passes `params.size` straight through as `image_size` (fal accepts both preset strings and `{width,height}` objects), so **only the type union changes** — no client code change.

- [ ] **Step 1: Write the failing test**

Append to the `describe('generate', ...)` block in `packages/shared/providers/tests/image.test.ts` (reuse the file's existing `imageResponse` helper and `client` factory):

```ts
  test('passes a custom {width, height} size through as image_size', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().generate({ prompt: 'og cover', size: { width: 1200, height: 630 } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      prompt: 'og cover',
      image_size: { width: 1200, height: 630 },
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run check:all`
Expected: FAIL — `{ width: 1200, height: 630 }` is not assignable to `ImageSize`. (The runtime test would pass — this is a type-level change — so the compile gate is the failing check.)

- [ ] **Step 3: Widen the type**

In `packages/shared/providers/src/image/types.ts`:

```ts
/** Neutral aspect/size enum (or exact pixels), mapped to the provider's own size param. */
export type ImageSize =
  | 'square'
  | 'landscape_16_9'
  | 'landscape_4_3'
  | 'portrait_16_9'
  | { width: number; height: number };
```

No change to `client.ts` — it already does `if (params.size) body.image_size = params.size;`.

- [ ] **Step 4: Verify**

Run: `npm run check:all && npm test -- image`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/providers
git commit -m "[providers] ImageSize accepts exact {width,height} for the OG cover (#51)"
```

---

### Task 3: Generation — image plan module (prompt, parse, H2 extraction, injection)

**Files:**
- Create: `packages/shared/generation/src/images.ts`
- Modify: `packages/shared/generation/src/config.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/images.test.ts` (create)

**Interfaces:**
- Consumes: `parseJsonObject` from `./json`, `LlmMessage` type from `@shared/providers`.
- Produces (all exported from `@shared/generation`):
  - `INLINE_IMAGE_COUNT = 2` (config constant)
  - `interface ImagePlanInput { businessName: string; businessDescription: string; language: string; imageStyle: string; articleTitle: string; metaDescription: string; headings: string[] }`
  - `buildImagePlanPrompt(input: ImagePlanInput): LlmMessage[]`
  - `ImagePlanSchema` / `type ImagePlan = { cover: { prompt: string; alt: string }; inline: { prompt: string; alt: string; section_heading: string }[] }`
  - `parseImagePlan(text: string, headings: string[]): ImagePlan` — throws on wrong inline count, unknown heading, or duplicate heading
  - `extractH2s(content: string): string[]`
  - `injectImageAfterHeading(content: string, heading: string, alt: string, url: string): string` — throws when the heading is missing

Note: generated articles always have ≥2 H2s (`MIN_H2 = 2` is enforced by `validateArticle` before an article is persisted), so `INLINE_IMAGE_COUNT = 2` distinct headings always exist.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/generation/tests/images.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { INLINE_IMAGE_COUNT } from '../src/config';
import {
  buildImagePlanPrompt,
  extractH2s,
  injectImageAfterHeading,
  parseImagePlan,
} from '../src/images';

const content = '# Title\n\nintro\n\n## First Section\n\nbody one\n\n## Second Section\n\nbody two';
const headings = ['First Section', 'Second Section'];

const validPlan = {
  cover: { prompt: 'a hero scene', alt: 'a hero image' },
  inline: [
    { prompt: 'p1', alt: 'alt one', section_heading: 'First Section' },
    { prompt: 'p2', alt: 'alt two', section_heading: 'Second Section' },
  ],
};

describe('extractH2s', () => {
  test('returns H2 texts in order, ignoring H1/H3', () => {
    expect(extractH2s(content)).toEqual(headings);
    expect(extractH2s('# only h1\n\n### h3')).toEqual([]);
  });
});

describe('buildImagePlanPrompt', () => {
  test('carries headings, style, language, and the inline count', () => {
    const messages = buildImagePlanPrompt({
      businessName: 'Acme',
      businessDescription: 'widgets',
      language: 'English',
      imageStyle: 'flat illustration',
      articleTitle: 'T',
      metaDescription: 'M',
      headings,
    });
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain(`exactly ${INLINE_IMAGE_COUNT}`);
    expect(messages[0]!.content).toContain('English');
    expect(messages[1]!.content).toContain('First Section | Second Section');
    expect(messages[1]!.content).toContain('flat illustration');
  });
});

describe('parseImagePlan', () => {
  test('accepts a valid plan (with an optional code fence)', () => {
    expect(parseImagePlan(JSON.stringify(validPlan), headings)).toEqual(validPlan);
    expect(parseImagePlan('```json\n' + JSON.stringify(validPlan) + '\n```', headings)).toEqual(
      validPlan,
    );
  });

  test('rejects wrong inline count', () => {
    const bad = { ...validPlan, inline: validPlan.inline.slice(0, 1) };
    expect(() => parseImagePlan(JSON.stringify(bad), headings)).toThrow(/exactly/);
  });

  test('rejects unknown and duplicate headings, and empty alt', () => {
    const unknown = {
      ...validPlan,
      inline: [validPlan.inline[0]!, { prompt: 'p', alt: 'a', section_heading: 'Nope' }],
    };
    expect(() => parseImagePlan(JSON.stringify(unknown), headings)).toThrow(/unknown heading/);

    const dup = {
      ...validPlan,
      inline: [validPlan.inline[0]!, { ...validPlan.inline[1]!, section_heading: 'First Section' }],
    };
    expect(() => parseImagePlan(JSON.stringify(dup), headings)).toThrow(/reuses heading/);

    const emptyAlt = { ...validPlan, cover: { prompt: 'p', alt: '' } };
    expect(() => parseImagePlan(JSON.stringify(emptyAlt), headings)).toThrow();
  });
});

describe('injectImageAfterHeading', () => {
  test('inserts the image right after the heading line', () => {
    const out = injectImageAfterHeading(content, 'First Section', 'alt one', 'https://cdn/x.png');
    const lines = out.split('\n');
    const idx = lines.indexOf('## First Section');
    expect(lines[idx + 1]).toBe('');
    expect(lines[idx + 2]).toBe('![alt one](https://cdn/x.png)');
    // the rest of the document is untouched
    expect(out).toContain('## Second Section\n\nbody two');
  });

  test('is anchored to the exact heading — unknown heading throws', () => {
    expect(() => injectImageAfterHeading(content, 'Missing', 'a', 'u')).toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- images`
Expected: FAIL — `../src/images` does not exist.

- [ ] **Step 3: Implement**

Append to `packages/shared/generation/src/config.ts`:

```ts
/** Inline images per article (#51); the cover is always additionally required. */
export const INLINE_IMAGE_COUNT = 2;
```

Create `packages/shared/generation/src/images.ts`:

```ts
import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { INLINE_IMAGE_COUNT } from './config';
import { parseJsonObject } from './json';

/** Inputs for the image-plan prompt — a subset of org presets + the article. */
export interface ImagePlanInput {
  businessName: string;
  businessDescription: string;
  language: string;
  imageStyle: string;
  articleTitle: string;
  metaDescription: string;
  headings: string[];
}

export const ImagePlanSchema = z.object({
  cover: z.object({ prompt: z.string().min(1), alt: z.string().min(1) }),
  inline: z.array(
    z.object({
      prompt: z.string().min(1),
      alt: z.string().min(1),
      section_heading: z.string().min(1),
    }),
  ),
});
export type ImagePlan = z.infer<typeof ImagePlanSchema>;

/** H2 heading texts, in order, from markdown content. */
export function extractH2s(content: string): string[] {
  return content
    .split('\n')
    .filter((l) => /^##\s+/.test(l))
    .map((l) => l.replace(/^##\s+/, '').trim());
}

export function buildImagePlanPrompt(input: ImagePlanInput): LlmMessage[] {
  const system = [
    'You are an art director planning images for one blog article.',
    'Respond with ONLY a JSON object of this shape:',
    '{ "cover": { "prompt": string, "alt": string },',
    '  "inline": [{ "prompt": string, "alt": string, "section_heading": string }] }',
    `Rules: exactly ${INLINE_IMAGE_COUNT} inline entries; each section_heading MUST be copied`,
    'EXACTLY from the provided section list, each from a DIFFERENT section. Prompts describe',
    'a single visual scene with no text or words in the image. alt is a meaningful',
    `description of the image for screen readers, written in ${input.language}.`,
  ].join('\n');

  const user = [
    `Business: ${input.businessName} — ${input.businessDescription}`,
    input.imageStyle ? `Image style: ${input.imageStyle}` : '',
    `Article title: ${input.articleTitle}`,
    `Article summary: ${input.metaDescription}`,
    `Sections: ${input.headings.join(' | ')}`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Parse + validate a plan; throws on wrong count, unknown or duplicate headings. */
export function parseImagePlan(text: string, headings: string[]): ImagePlan {
  const plan = ImagePlanSchema.parse(parseJsonObject(text));
  if (plan.inline.length !== INLINE_IMAGE_COUNT)
    throw new Error(`image plan needs exactly ${INLINE_IMAGE_COUNT} inline images`);
  const seen = new Set<string>();
  for (const img of plan.inline) {
    if (!headings.includes(img.section_heading))
      throw new Error(`image plan references unknown heading: ${img.section_heading}`);
    if (seen.has(img.section_heading))
      throw new Error(`image plan reuses heading: ${img.section_heading}`);
    seen.add(img.section_heading);
  }
  return plan;
}

/** Insert `![alt](url)` right after the `## heading` line. Throws when missing. */
export function injectImageAfterHeading(
  content: string,
  heading: string,
  alt: string,
  url: string,
): string {
  const lines = content.split('\n');
  const idx = lines.findIndex(
    (l) => /^##\s+/.test(l) && l.replace(/^##\s+/, '').trim() === heading,
  );
  if (idx === -1) throw new Error(`heading not found in content: ${heading}`);
  lines.splice(idx + 1, 0, '', `![${alt}](${url})`);
  return lines.join('\n');
}
```

Add to `packages/shared/generation/src/index.ts` (keep Biome's alphabetical import order):

```ts
export { INLINE_IMAGE_COUNT } from './config';
export {
  buildImagePlanPrompt,
  extractH2s,
  ImagePlanSchema,
  injectImageAfterHeading,
  parseImagePlan,
} from './images';
```

(Merge `INLINE_IMAGE_COUNT` into the existing `./config` export line: `export { HUMANIZE, INLINE_IMAGE_COUNT, MAX_GENERATION_ATTEMPTS } from './config';` — and add `export type { ImagePlan, ImagePlanInput } from './images';`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- images`
Expected: PASS (the providers `image` test file also matches this filter — both must pass).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/generation
git commit -m "[generation] Image plan prompt/parse + H2 injection helpers (#51)"
```

---

### Task 4: DB — `ArticleRepo` image-slot methods

**Files:**
- Modify: `packages/shared/db/src/repositories/article.repo.ts`
- Test: `packages/shared/db/tests/article.repo.images.integration.test.ts` (create)

**Interfaces:**
- Consumes: `ArticleImage` type from `@shared/schemas` (Task 1).
- Produces (on `ArticleRepo`):
  - `setImagePlan(id: string, images: ArticleImage[]): Promise<boolean>` — set-if-absent (only when `images` is empty); returns false when already planned or bad id
  - `fillImageSlot(id: string, index: number, fill: { url: string; model: string; seed: number | null; generated_at: Date }, newContent: string | null): Promise<boolean>` — fills slot `index` only while its `url === ''` (pending→generated guard, prevents double markdown injection); `newContent` replaces `content` atomically in the same update (null = leave content alone, used for the cover)
  - `completeImages(id: string, coverUrl: string): Promise<boolean>` — sets `images_status: 'complete'` + `featured_image_url` only when every slot has a url and status isn't already complete
  - `failImages(id: string): Promise<void>` — sets `images_status: 'failed'` unless complete

- [ ] **Step 1: Write the failing integration test**

Create `packages/shared/db/tests/article.repo.images.integration.test.ts` (note: scope deletes to `org_img` — other integration files share the collection):

```ts
import type { ArticleImage, CreateArticleInput } from '@shared/schemas';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ArticleRepo } from '../src/repositories/article.repo';

const base: CreateArticleInput = {
  org_id: 'org_img',
  keyword_id: 'k1',
  title: 'T',
  meta_title: 'T meta',
  slug: 's',
  keyword: 'kw',
  meta_description: 'm',
  featured_image_url: '',
  content: '# T\n\nintro\n\n## A\n\nbody a\n\n## B\n\nbody b',
  difficulty: 10,
  search_volume: 20,
  status: 'generated',
  published_at: null,
};

const slot = (over: Partial<ArticleImage>): ArticleImage => ({
  role: 'inline',
  section_heading: 'A',
  prompt: 'p',
  alt: 'alt',
  url: '',
  model: null,
  seed: null,
  generated_at: null,
  ...over,
});

const plan: ArticleImage[] = [
  slot({ role: 'cover', section_heading: null }),
  slot({ section_heading: 'A' }),
  slot({ section_heading: 'B' }),
];

describe('ArticleRepo image slots (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('articles').deleteMany({ org_id: 'org_img' });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create defaults images to [] / pending', async () => {
    const a = await ArticleRepo.create(base);
    expect(a.images).toEqual([]);
    expect(a.images_status).toBe('pending');
  });

  test('setImagePlan is set-if-absent', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'plan' });
    expect(await ArticleRepo.setImagePlan(a.id, plan)).toBe(true);
    expect(await ArticleRepo.setImagePlan(a.id, plan)).toBe(false); // already planned
    const found = await ArticleRepo.findById(a.id);
    expect(found!.images).toHaveLength(3);
    expect(await ArticleRepo.setImagePlan('not-an-objectid', plan)).toBe(false);
  });

  test('fillImageSlot fills once and can swap content atomically', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'fill' });
    await ArticleRepo.setImagePlan(a.id, plan);
    const fill = { url: 'https://cdn/x.png', model: 'm', seed: 7, generated_at: new Date() };

    expect(await ArticleRepo.fillImageSlot(a.id, 1, fill, 'NEW CONTENT')).toBe(true);
    let found = await ArticleRepo.findById(a.id);
    expect(found!.images[1]!.url).toBe('https://cdn/x.png');
    expect(found!.content).toBe('NEW CONTENT');

    // second fill of the same slot is a no-op (idempotent redelivery)
    expect(await ArticleRepo.fillImageSlot(a.id, 1, fill, 'CLOBBER')).toBe(false);
    found = await ArticleRepo.findById(a.id);
    expect(found!.content).toBe('NEW CONTENT');

    // cover fill with newContent = null leaves content alone
    expect(await ArticleRepo.fillImageSlot(a.id, 0, fill, null)).toBe(true);
    found = await ArticleRepo.findById(a.id);
    expect(found!.content).toBe('NEW CONTENT');
  });

  test('completeImages only fires when every slot is filled', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'complete' });
    await ArticleRepo.setImagePlan(a.id, plan);
    const fill = { url: 'https://cdn/c.png', model: 'm', seed: null, generated_at: new Date() };

    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/c.png')).toBe(false); // none filled
    await ArticleRepo.fillImageSlot(a.id, 0, fill, null);
    await ArticleRepo.fillImageSlot(a.id, 1, fill, null);
    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/c.png')).toBe(false); // one empty
    await ArticleRepo.fillImageSlot(a.id, 2, fill, null);
    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/c.png')).toBe(true);

    const found = await ArticleRepo.findById(a.id);
    expect(found!.images_status).toBe('complete');
    expect(found!.featured_image_url).toBe('https://cdn/c.png');
  });

  test('failImages marks failed but never downgrades complete; complete recovers from failed', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'fail' });
    await ArticleRepo.setImagePlan(a.id, plan);
    await ArticleRepo.failImages(a.id);
    expect((await ArticleRepo.findById(a.id))!.images_status).toBe('failed');

    // a later successful pass can still complete from 'failed'
    const fill = { url: 'https://cdn/z.png', model: 'm', seed: null, generated_at: new Date() };
    await ArticleRepo.fillImageSlot(a.id, 0, fill, null);
    await ArticleRepo.fillImageSlot(a.id, 1, fill, null);
    await ArticleRepo.fillImageSlot(a.id, 2, fill, null);
    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/z.png')).toBe(true);

    await ArticleRepo.failImages(a.id); // must NOT downgrade
    expect((await ArticleRepo.findById(a.id))!.images_status).toBe('complete');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose up -d mongo && npm run test:integration`
Expected: FAIL — `setImagePlan` is not a function.

- [ ] **Step 3: Implement the repo methods**

In `packages/shared/db/src/repositories/article.repo.ts`: add `ArticleImage` to the type import from `@shared/schemas`, then append inside `ArticleRepo` after `create`:

```ts
  /** Persist the image plan once (set-if-absent) — a retry never re-plans (#51). */
  async setImagePlan(id: string, images: ArticleImage[]): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), 'images.0': { $exists: false } },
      { $set: { images, images_status: 'pending' } },
    );
    return res.modifiedCount === 1;
  },

  /**
   * Fill slot `index` — only while its url is '' (pending→generated guard, so a
   * redelivery can't double-fill or double-inject). `newContent` swaps the
   * article markdown atomically in the same update (null = leave content alone).
   */
  async fillImageSlot(
    id: string,
    index: number,
    fill: { url: string; model: string; seed: number | null; generated_at: Date },
    newContent: string | null,
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const set: Document = {
      [`images.${index}.url`]: fill.url,
      [`images.${index}.model`]: fill.model,
      [`images.${index}.seed`]: fill.seed,
      [`images.${index}.generated_at`]: fill.generated_at,
    };
    if (newContent !== null) set.content = newContent;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), [`images.${index}.url`]: '' },
      { $set: set },
    );
    return res.modifiedCount === 1;
  },

  /** Mark images complete + set the cover as featured — only when every slot is filled (#51). */
  async completeImages(id: string, coverUrl: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        images_status: { $ne: 'complete' },
        'images.0': { $exists: true },
        images: { $not: { $elemMatch: { url: '' } } },
      },
      { $set: { images_status: 'complete', featured_image_url: coverUrl } },
    );
    return res.modifiedCount === 1;
  },

  /** Record an image-plan failure. Never downgrades a completed article (#51). */
  async failImages(id: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id), images_status: { $ne: 'complete' } },
      { $set: { images_status: 'failed' } },
    );
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:integration`
Expected: PASS (all integration files, not just the new one).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/db
git commit -m "[db] ArticleRepo image-slot methods: plan/fill/complete/fail (#51)"
```

---

### Task 5: Worker — storage helper, image clients, images handler, generation enqueue

**Files:**
- Create: `apps/worker/src/storage.ts`
- Create: `apps/worker/src/images.ts`
- Modify: `apps/worker/src/providers.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/generation.ts`
- Modify: `apps/worker/package.json` (add `"@aws-sdk/client-s3": "^3.1075.0"` to dependencies)
- Test: `apps/worker/tests/storage.test.ts` (create), `apps/worker/tests/images.test.ts` (create), `apps/worker/tests/generation.test.ts` (extend)

**Interfaces:**
- Consumes: `ImageTask`, `type ArticleImage` (Task 1); `buildImagePlanPrompt`, `parseImagePlan`, `extractH2s`, `injectImageAfterHeading` (Task 3); `ArticleRepo.setImagePlan/fillImageSlot/completeImages/failImages` (Task 4); `createFalClient` + custom size (Task 2).
- Produces: `storeImage(key: string, bytes: Uint8Array, contentType: string): Promise<string | null>`; `getImageClients(): { llm: LlmClient; image: ImageClient }`; `enqueueImageTask(task: ImageTask): Promise<void>`; SQS `handler` in `apps/worker/src/images.ts` (Task 6 wires it to infra + dev poller).

- [ ] **Step 1: Add the S3 dependency**

In `apps/worker/package.json` dependencies, after `"@aws-sdk/client-sqs"`:

```json
    "@aws-sdk/client-s3": "^3.1075.0",
```

Run: `npm install`
Expected: lockfile updates. **macOS lockfile gotcha:** afterwards run `git diff package-lock.json` and check no `@emnapi`/Linux-optional entries were dropped; if they were, restore per the memory `npm-lock-macos-prunes-emnapi` (restore graph from a known-good commit and re-add the new entries by hand).

- [ ] **Step 2: Write the failing storage test**

Create `apps/worker/tests/storage.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn(async () => ({})) }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { storeImage } from '../src/storage';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('storeImage', () => {
  test('returns null (dev fallback) when IMAGES_BUCKET is unset', async () => {
    vi.stubEnv('IMAGES_BUCKET', '');
    expect(await storeImage('articles/a/cover.png', new Uint8Array([1]), 'image/png')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test('uploads and returns the CDN URL', async () => {
    vi.stubEnv('IMAGES_BUCKET', 'bkt');
    vi.stubEnv('IMAGES_CDN_DOMAIN', 'dxyz.cloudfront.net');
    const url = await storeImage('articles/a/cover.png', new Uint8Array([1]), 'image/png');
    expect(url).toBe('https://dxyz.cloudfront.net/articles/a/cover.png');
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as { input: unknown }).input).toMatchObject({
      Bucket: 'bkt',
      Key: 'articles/a/cover.png',
      ContentType: 'image/png',
    });
  });

  test('throws when the bucket is set but the CDN domain is not', async () => {
    vi.stubEnv('IMAGES_BUCKET', 'bkt');
    vi.stubEnv('IMAGES_CDN_DOMAIN', '');
    await expect(storeImage('k', new Uint8Array([1]), 'image/png')).rejects.toThrow(
      /IMAGES_CDN_DOMAIN/,
    );
  });
});
```

Run: `npm test -- storage`
Expected: FAIL — `../src/storage` does not exist.

- [ ] **Step 3: Implement `storage.ts`**

Create `apps/worker/src/storage.ts`:

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Module-scoped for Lambda warm reuse, matching the SQS client in queue.ts.
const s3 = new S3Client({});

/**
 * Upload image bytes to the per-stage images bucket; returns the public
 * CloudFront URL. Returns null when IMAGES_BUCKET is unset — local dev
 * fallback so the pipeline runs without AWS credentials (#51).
 */
export async function storeImage(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const bucket = process.env.IMAGES_BUCKET;
  if (!bucket) return null;
  const domain = process.env.IMAGES_CDN_DOMAIN;
  if (!domain) throw new Error('IMAGES_CDN_DOMAIN is required when IMAGES_BUCKET is set');
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
  );
  return `https://${domain}/${key}`;
}
```

Run: `npm test -- storage`
Expected: PASS.

- [ ] **Step 4: Add the image clients and the enqueue helper**

In `apps/worker/src/providers.ts`: add `createFalClient` to the import from `@shared/providers`, and append:

```ts
/** Build the LLM (plan) + image (fal) clients the images worker needs, from env (#51). */
export function getImageClients() {
  return {
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
    image: createFalClient({ apiKey: process.env.FAL_KEY ?? '' }),
  };
}
```

In `apps/worker/src/queue.ts`: change the type import to `import type { GenerateTask, ImageTask } from '@shared/schemas';` and append:

```ts
/** Enqueue one article-image task for the images worker (#51). */
export async function enqueueImageTask(task: ImageTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.IMAGES_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
```

- [ ] **Step 5: Write the failing images-handler test**

Create `apps/worker/tests/images.test.ts`. It mocks `@shared/db`, `../src/providers`, and `../src/storage`, but uses the **real** `@shared/generation` plan-parse and markdown-injection code:

```ts
import type { SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { findArticleById, setImagePlan, fillImageSlot, completeImages, failImages, findOrgById } =
  vi.hoisted(() => ({
    findArticleById: vi.fn(),
    setImagePlan: vi.fn(async () => true),
    fillImageSlot: vi.fn(async () => true),
    completeImages: vi.fn(async () => true),
    failImages: vi.fn(async () => {}),
    findOrgById: vi.fn(),
  }));
vi.mock('@shared/db', () => ({
  ArticleRepo: {
    findById: findArticleById,
    setImagePlan,
    fillImageSlot,
    completeImages,
    failImages,
  },
  OrgRepo: { findById: findOrgById },
}));

const { llmComplete, imageGenerate } = vi.hoisted(() => ({
  llmComplete: vi.fn(),
  imageGenerate: vi.fn(async () => ({
    images: [{ url: 'https://fal.media/img.png', width: 1, height: 1 }],
    seed: 7,
  })),
}));
vi.mock('../src/providers', () => ({
  getImageClients: () => ({ llm: { complete: llmComplete }, image: { generate: imageGenerate } }),
}));

const { storeImage } = vi.hoisted(() => ({
  storeImage: vi.fn(async (key: string) => `https://cdn.example/${key}`),
}));
vi.mock('../src/storage', () => ({ storeImage }));

import type { ArticleImage } from '@shared/schemas';
import { handler } from '../src/images';

function event(body: unknown): SQSEvent {
  return {
    Records: [
      {
        messageId: '1',
        receiptHandle: 'rh',
        body: JSON.stringify(body),
        attributes: {} as never,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

const content = '# T\n\nintro\n\n## First Section\n\nbody a\n\n## Second Section\n\nbody b';
const article = {
  id: 'a1',
  org_id: 'o1',
  keyword_id: 'k1',
  title: 'T',
  meta_title: 'mt',
  slug: 's',
  keyword: 'kw',
  meta_description: 'md',
  featured_image_url: '',
  content,
  difficulty: 1,
  search_volume: 2,
  status: 'generated',
  created_at: new Date(),
  published_at: null,
  images: [] as ArticleImage[],
  images_status: 'pending',
};

const org = {
  id: 'o1',
  plan: 'paid',
  website_url: 'https://x.com',
  presets: {
    business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
    audience: { target: 'makers', competitors: [] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: { article_style: 'x', internal_links: false, llm_instructions: '' },
      engagement: { image_style: 'flat illustration' },
    },
  },
};

const planJson = JSON.stringify({
  cover: { prompt: 'cover scene', alt: 'cover alt' },
  inline: [
    { prompt: 'p1', alt: 'alt one', section_heading: 'First Section' },
    { prompt: 'p2', alt: 'alt two', section_heading: 'Second Section' },
  ],
});

const slot = (over: Partial<ArticleImage>): ArticleImage => ({
  role: 'inline',
  section_heading: null,
  prompt: 'p',
  alt: 'alt',
  url: '',
  model: null,
  seed: null,
  generated_at: null,
  ...over,
});
// Factory, not a shared const: the handler mutates slot.url, which would
// otherwise leak between tests.
const plannedSlots = (): ArticleImage[] => [
  slot({ role: 'cover', prompt: 'cover scene', alt: 'cover alt' }),
  slot({ prompt: 'p1', alt: 'alt one', section_heading: 'First Section' }),
  slot({ prompt: 'p2', alt: 'alt two', section_heading: 'Second Section' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('images worker', () => {
  test('plans, generates all slots, injects inline markdown, completes', async () => {
    findArticleById
      .mockResolvedValueOnce({ ...article, images: [] }) // initial load: no plan yet
      .mockResolvedValueOnce({ ...article, images: plannedSlots() }); // reload after plan
    findOrgById.mockResolvedValue(org);
    llmComplete.mockResolvedValue({
      text: planJson,
      model: 'm',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 },
    });

    await handler(event({ org_id: 'o1', article_id: 'a1' }), {} as never, () => {});

    // plan persisted set-if-absent, cover first
    expect(setImagePlan).toHaveBeenCalledTimes(1);
    const slots = setImagePlan.mock.calls[0]![1] as ArticleImage[];
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ role: 'cover', section_heading: null, url: '' });
    expect(slots[1]).toMatchObject({ role: 'inline', section_heading: 'First Section' });

    // cover uses exact OG pixels; inline uses the preset
    expect(imageGenerate).toHaveBeenCalledTimes(3);
    expect(imageGenerate.mock.calls[0]![0]).toMatchObject({ size: { width: 1200, height: 630 } });
    expect(imageGenerate.mock.calls[1]![0]).toMatchObject({ size: 'landscape_16_9' });

    // deterministic keys
    expect(storeImage.mock.calls.map((c) => c[0])).toEqual([
      'articles/a1/cover.png',
      'articles/a1/inline-1.png',
      'articles/a1/inline-2.png',
    ]);

    // inline fills carry injected markdown; cover leaves content alone
    expect(fillImageSlot).toHaveBeenCalledTimes(3);
    expect(fillImageSlot.mock.calls[0]![3]).toBeNull();
    expect(fillImageSlot.mock.calls[1]![3]).toContain(
      '![alt one](https://cdn.example/articles/a1/inline-1.png)',
    );

    expect(completeImages).toHaveBeenCalledWith('a1', 'https://cdn.example/articles/a1/cover.png');
  });

  test('skips when images are already complete', async () => {
    findArticleById.mockResolvedValue({ ...article, images_status: 'complete' });
    await handler(event({ org_id: 'o1', article_id: 'a1' }), {} as never, () => {});
    expect(llmComplete).not.toHaveBeenCalled();
    expect(imageGenerate).not.toHaveBeenCalled();
  });

  test('resumes: filled slots are skipped, no re-plan', async () => {
    const slots = plannedSlots();
    const partial = [
      { ...slots[0]!, url: 'https://cdn.example/articles/a1/cover.png' },
      slots[1]!,
      slots[2]!,
    ];
    findArticleById.mockResolvedValue({ ...article, images: partial });

    await handler(event({ org_id: 'o1', article_id: 'a1' }), {} as never, () => {});

    expect(llmComplete).not.toHaveBeenCalled();
    expect(setImagePlan).not.toHaveBeenCalled();
    expect(imageGenerate).toHaveBeenCalledTimes(2); // only the two inline slots
    expect(completeImages).toHaveBeenCalledWith('a1', 'https://cdn.example/articles/a1/cover.png');
  });

  test('invalid plan marks images failed and rethrows', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    findOrgById.mockResolvedValue(org);
    llmComplete.mockResolvedValue({
      text: JSON.stringify({ cover: { prompt: 'p', alt: 'a' }, inline: [] }),
      model: 'm',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 },
    });

    await expect(
      handler(event({ org_id: 'o1', article_id: 'a1' }), {} as never, () => {}),
    ).rejects.toThrow(/exactly/);
    expect(failImages).toHaveBeenCalledWith('a1');
    expect(imageGenerate).not.toHaveBeenCalled();
  });

  test('provider error mid-generation rethrows WITHOUT marking failed (stays retryable)', async () => {
    findArticleById.mockResolvedValue({ ...article, images: plannedSlots() });
    imageGenerate.mockRejectedValueOnce(new Error('rate limited'));

    await expect(
      handler(event({ org_id: 'o1', article_id: 'a1' }), {} as never, () => {}),
    ).rejects.toThrow('rate limited');
    expect(failImages).not.toHaveBeenCalled();
    expect(completeImages).not.toHaveBeenCalled();
  });

  test('missing article is skipped without error', async () => {
    findArticleById.mockResolvedValue(null);
    await handler(event({ org_id: 'o1', article_id: 'gone' }), {} as never, () => {});
    expect(imageGenerate).not.toHaveBeenCalled();
  });
});
```

Run: `npm test -- tests/images`
Expected: FAIL — `../src/images` does not exist.

- [ ] **Step 6: Implement the images handler**

Create `apps/worker/src/images.ts`:

```ts
import { ArticleRepo, OrgRepo } from '@shared/db';
import {
  buildImagePlanPrompt,
  extractH2s,
  injectImageAfterHeading,
  parseImagePlan,
} from '@shared/generation';
import { type ArticleImage, ImageTask } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getImageClients } from './providers';
import { storeImage } from './storage';

/** Recorded on each slot; passed explicitly to generate so metadata stays truthful. */
const IMAGE_MODEL = 'fal-ai/flux/dev';

/** Deterministic S3 key per slot — retries overwrite, never duplicate (#51). */
function slotKey(articleId: string, role: ArticleImage['role'], index: number, ext: string) {
  return `articles/${articleId}/${role === 'cover' ? 'cover' : `inline-${index}`}.${ext}`;
}

/**
 * Images worker — triggered by SQS (enqueued by the generation worker after an
 * article persists). Plans cover + inline images once (set-if-absent), then
 * fills unfinished slots idempotently: generate via fal -> store in S3 behind
 * CloudFront -> record URL (+ inject inline markdown after its H2). All slots
 * filled => images_status 'complete' + featured_image_url. Provider errors
 * rethrow so SQS redelivers and the loop resumes at the first unfinished slot
 * (-> DLQ after 3). See design/article-images.md & #51.
 */
export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let articleId: string | undefined;
    try {
      const task = ImageTask.parse(JSON.parse(record.body));
      articleId = task.article_id;
      logger.appendKeys({ org_id: task.org_id, article_id: articleId });

      let article = await ArticleRepo.findById(articleId);
      if (!article) {
        logger.warn('images skipped: article missing');
        continue;
      }
      if (article.images_status === 'complete') {
        logger.info('images skipped: already complete');
        continue;
      }

      const { llm, image } = getImageClients();

      // Plan once (set-if-absent): a redelivery never re-plans or reshuffles slots.
      if (article.images.length === 0) {
        const org = await OrgRepo.findById(task.org_id);
        if (!org?.presets) {
          logger.warn('images skipped: org or presets missing');
          continue;
        }
        const headings = extractH2s(article.content);
        const res = await llm.complete({
          messages: buildImagePlanPrompt({
            businessName: org.presets.business.name,
            businessDescription: org.presets.business.description,
            language: org.presets.business.language,
            imageStyle: org.presets.article_preferences.engagement.image_style,
            articleTitle: article.title,
            metaDescription: article.meta_description,
            headings,
          }),
          responseFormat: 'json',
        });
        let plan: ReturnType<typeof parseImagePlan>;
        try {
          plan = parseImagePlan(res.text, headings);
        } catch (err) {
          // Bad plan: mark failed (ops-visible) and rethrow; a redelivery re-plans.
          await ArticleRepo.failImages(articleId).catch(() => {});
          throw err;
        }
        const empty = { url: '', model: null, seed: null, generated_at: null };
        const slots: ArticleImage[] = [
          { role: 'cover', section_heading: null, ...plan.cover, ...empty },
          ...plan.inline.map(
            (img): ArticleImage => ({ role: 'inline', ...img, ...empty }),
          ),
        ];
        await ArticleRepo.setImagePlan(articleId, slots); // false = raced; reload below
        article = await ArticleRepo.findById(articleId);
        if (!article) continue;
      }

      // Fill unfinished slots; finished ones are skipped (idempotent resume).
      let content = article.content;
      for (const [i, slot] of article.images.entries()) {
        if (slot.url !== '') continue;
        const res = await image.generate({
          prompt: slot.prompt,
          model: IMAGE_MODEL,
          size: slot.role === 'cover' ? { width: 1200, height: 630 } : 'landscape_16_9',
        });
        const src = res.images[0]?.url;
        if (!src) throw new Error('image provider returned no image');

        const imgRes = await fetch(src);
        if (!imgRes.ok) throw new Error(`image download failed (${imgRes.status})`);
        const contentType = imgRes.headers.get('content-type') ?? 'image/png';
        const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';
        const bytes = new Uint8Array(await imgRes.arrayBuffer());

        const stored = await storeImage(slotKey(articleId, slot.role, i, ext), bytes, contentType);
        if (!stored) logger.warn('IMAGES_BUCKET unset: storing provider URL (local dev only)');
        const url = stored ?? src;

        const newContent =
          slot.role === 'inline' && slot.section_heading
            ? injectImageAfterHeading(content, slot.section_heading, slot.alt, url)
            : null;
        await ArticleRepo.fillImageSlot(
          articleId,
          i,
          { url, model: IMAGE_MODEL, seed: res.seed, generated_at: new Date() },
          newContent,
        );
        if (newContent) content = newContent;
        slot.url = url; // local view for the completion step below
      }

      const cover = article.images.find((s) => s.role === 'cover');
      if (!cover?.url) throw new Error('cover slot missing after fill');
      await ArticleRepo.completeImages(articleId, cover.url);
      logger.info('article images complete');
    } catch (err) {
      // Rethrow so SQS redelivers (finished slots are skipped on resume; -> DLQ after 3).
      logger.error('image generation failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id', 'article_id']);
    }
  }
};
```

Run: `npm test -- tests/images`
Expected: PASS (6 tests).

- [ ] **Step 7: Enqueue from the generation worker (failing test first)**

In `apps/worker/tests/generation.test.ts`, add a queue mock after the providers mock (line ~31):

```ts
const { enqueueImageTask } = vi.hoisted(() => ({ enqueueImageTask: vi.fn(async () => {}) }));
vi.mock('../src/queue', () => ({ enqueueImageTask }));
```

And in the first test (`claims, generates, persists article, links keyword`), append:

```ts
    expect(enqueueImageTask).toHaveBeenCalledWith({ org_id: 'o1', article_id: 'art1' });
```

Run: `npm test -- generation`
Expected: FAIL — `enqueueImageTask` not called.

In `apps/worker/src/generation.ts`: add `import { enqueueImageTask } from './queue';` and, after the `KeywordRepo.linkArticle(keyword.id, article.id);` line:

```ts
      await enqueueImageTask({ org_id: org.id, article_id: article.id });
```

Also update the `featured_image_url: '', // populated by #51` comment to `featured_image_url: '', // populated by the images worker (#51)`.

Run: `npm test -- generation`
Expected: PASS.

- [ ] **Step 8: Full gates + commit**

Run: `npm run lint && npm run check:all && npm test`
Expected: all PASS.

```bash
git add apps/worker package-lock.json
git commit -m "[worker] Images worker: plan -> generate -> S3/CloudFront -> attach (#51)"
```

---

### Task 6: Wiring — ElasticMQ, env, dev poller, CDK (bucket + CDN + queue + Lambda)

**Files:**
- Modify: `elasticmq.conf`
- Modify: `.env.example`
- Modify: `apps/worker/src/dev.ts`
- Modify: `infra/lib/api-stack.ts`
- Modify: `design/article-images.md` (secrets-pattern note)

**Interfaces:**
- Consumes: `handler` from `apps/worker/src/images.ts` (Task 5).
- Produces: `IMAGES_QUEUE_URL`, `IMAGES_BUCKET`, `IMAGES_CDN_DOMAIN` env contract; deployed `ImagesQueue`/`ImagesDlq`/`ImagesWorkerFn`/`ImagesBucket`/`ImagesCdn`; generation worker granted send on the images queue.

- [ ] **Step 1: Local queue + env**

In `elasticmq.conf`, add to the `queues` block:

```
  images-queue {}
```

In `.env.example`, after the `GENERATION_QUEUE_URL` line:

```
IMAGES_QUEUE_URL=http://localhost:9324/000000000000/images-queue
```

And after the `FAL_KEY=` block, append:

```
# Images S3/CloudFront (deployed only — set by CDK on the images worker Lambda).
# Leave unset locally: the worker then stores the provider URL directly (dev fallback).
# IMAGES_BUCKET=
# IMAGES_CDN_DOMAIN=
```

Mirror the `IMAGES_QUEUE_URL` line into your local `.env` too (it's gitignored — needed for the dev poller to pick the queue up).

- [ ] **Step 2: Dev poller**

In `apps/worker/src/dev.ts`: add `import { handler as imagesHandler } from './images';` (keep alphabetical order among the handler imports) and, after the `generationUrl` lines:

```ts
const imagesUrl = process.env.IMAGES_QUEUE_URL;
```

```ts
if (imagesUrl) pollers.push(pollQueue('images', imagesUrl, imagesHandler));
```

- [ ] **Step 3: CDK**

In `infra/lib/api-stack.ts`, add imports (keep Biome-alphabetical):

```ts
import { CachePolicy, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
```

Insert **before** the `GenerationWorkerFn` block (the generation worker needs `imagesQueue` in scope):

```ts
    // Article images (#51): private per-stage bucket + CloudFront (OAC) — durable,
    // provider-independent image URLs. Objects are immutable at a given key
    // (retries overwrite BEFORE the URL is stored), so long default TTLs are safe.
    const imagesBucket = new Bucket(this, 'ImagesBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });
    const imagesCdn = new Distribution(this, 'ImagesCdn', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(imagesBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
    });

    // Dead-letter queue: image tasks that fail repeatedly land here.
    const imagesDlq = new Queue(this, 'ImagesDlq', {
      retentionPeriod: Duration.days(14),
    });

    // Image task queue. Visibility timeout >= worker timeout so an in-flight
    // message isn't redelivered mid-generation (image generation is slow).
    const imagesQueue = new Queue(this, 'ImagesQueue', {
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: imagesDlq, maxReceiveCount: 3 },
    });

    // Images worker Lambda — consumes image tasks; plans, generates, and stores
    // article images. FAL_KEY follows the existing synth-time provider-secret
    // pattern (SSM provisioning deferred — #9/#43).
    const imagesWorkerFn = new NodejsFunction(this, 'ImagesWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/images.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
        FAL_KEY: process.env.FAL_KEY ?? '',
        IMAGES_BUCKET: imagesBucket.bucketName,
        IMAGES_CDN_DOMAIN: imagesCdn.distributionDomainName,
      },
      bundling,
    });
    imagesWorkerFn.addEventSource(new SqsEventSource(imagesQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(imagesWorkerFn);
    imagesBucket.grantPut(imagesWorkerFn);
```

In the existing `GenerationWorkerFn` block, add to its `environment`:

```ts
        IMAGES_QUEUE_URL: imagesQueue.queueUrl,
```

and after its grants:

```ts
    imagesQueue.grantSendMessages(generationWorkerFn);
```

At the bottom near `HttpApiUrl`, add:

```ts
    // Image CDN domain — the base of every stored article-image URL.
    new CfnOutput(this, 'ImagesCdnDomain', { value: imagesCdn.distributionDomainName });
```

- [ ] **Step 4: Align the spec's secrets wording**

In `design/article-images.md`, in the secrets table row for the fal.ai API key, change the "Deployed" cell to:

```
synth-time env (`FAL_KEY`), matching the existing provider-secret pattern; per-stage SSM SecureString provisioning is deferred with the rest (#9/#43)
```

- [ ] **Step 5: Verify synth + local dev**

Run: `cd infra && npm install && npm run synth && cd ..`
Expected: both `SeoApiStack-staging` and `SeoApiStack-prod` synth without errors.

Local smoke (optional but recommended): `docker compose up -d && npm run dev` — the worker log must show `[worker:images] polling http://localhost:9324/000000000000/images-queue`.

- [ ] **Step 6: Commit**

```bash
npm run lint
git add elasticmq.conf .env.example apps/worker/src/dev.ts infra/lib/api-stack.ts design/article-images.md
git commit -m "[infra] Images queue + worker Lambda + S3/CloudFront CDN (#51)"
```

---

### Task 7: Docs, gates, PR

**Files:**
- Modify: `PROGRESS.md`

**Interfaces:** none — bookkeeping + verification.

- [ ] **Step 1: Update PROGRESS.md**

Replace the article-generation line's trailing `Image generation pending — [#51](...)` (Dashboard section, the `✅ Article generation (#55)` bullet) with:

```
Cover + inline images (#51): image SQS task after generation → plan → fal.ai → per-stage S3+CloudFront, idempotent per-slot retries
```

and update the `_Last updated:_` line's date/note accordingly.

- [ ] **Step 2: Full gates**

Run: `npm run lint && npm run check:all && npm test`
Expected: all PASS.
Run: `docker compose up -d mongo && npm run test:integration`
Expected: PASS.

- [ ] **Step 3: Commit + PR**

```bash
git add PROGRESS.md
git commit -m "[docs] PROGRESS: article images (#51) landed"
git push -u origin faruk/article-images
gh pr create --base dev --title "[dashboard] Article cover + inline images (#51)" --body "$(cat <<'EOF'
Implements the image pipeline per design/article-images.md.

- Generation worker enqueues ImageTask after persisting an article
- Images worker: LLM image plan (cover + 2 inline, validated against real H2s, set-if-absent) → fal.ai → per-stage private S3 bucket behind CloudFront (OAC) → slot recorded, inline markdown injected after its H2
- Idempotent per-slot retries via SQS redelivery; deterministic S3 keys (no orphans/duplicates)
- images_status gates future publishing; featured_image_url = cover URL
- FAL_KEY wired via the existing synth-time provider-secret pattern (SSM deferred, #9/#43)

Closes #51

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note for the reviewer/operator: the deployed stage needs `FAL_KEY` present in the deploy environment (same mechanism as `OPENROUTER_API_KEY`), and the CloudFront custom-domain decision (spec's "Decide before prod" flag) stays open — staging can ship on the default `*.cloudfront.net` domain.
