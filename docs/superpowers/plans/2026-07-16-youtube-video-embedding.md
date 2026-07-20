# YouTube Video Embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each generated article gets one auto-sourced, relevant embedded YouTube video (issue #85), per `design/article-youtube-video.md`.

**Architecture:** A new YouTube Data API v3 provider client searches videos by keyword; the generation worker (inline, between validation and persist, non-fatal) has an LLM pick the most relevant candidate and target H2, injects a `youtube-nocookie.com` iframe into the article markdown, and stores a structured `video` field on the Article. A defaulted presets toggle (`engagement.include_youtube_video`) gates the step.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, Hono/OpenAPIHono, plain `fetch` provider clients, AWS CDK (env var wiring only).

## Global Constraints

- Branch: `ozykhan/youtube-video-embedding` (already created off `dev`; design doc committed).
- Biome formatting: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after writing code; `npm run lint` must pass.
- `verbatimModuleSyntax`: use `import type` / `export type` for type-only imports/re-exports.
- Shared packages export TS source; add new exports to each package's `src/index.ts`.
- Repositories parse through Zod at the boundary — new Article/presets fields MUST have `.default(...)` / `.nullable().default(null)` so pre-#85 documents still parse.
- Never fail, delay, or SQS-redeliver article generation because of the video step.
- The YouTube API key must never appear in error messages (it travels in the query string — never echo the URL into an Error).
- All commits end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Before claiming done: `npm run lint`, `npm run check:all`, `npm test` all pass.

---

### Task 1: Schemas — `Article.video` + presets toggle

**Files:**
- Modify: `packages/shared/schemas/src/article.ts`
- Modify: `packages/shared/schemas/src/presets.ts`
- Test: `packages/shared/schemas/tests/article-video.test.ts` (new)
- Modify: `apps/api/tests/merge-presets.test.ts` (typed fixture gains the new required field)

**Interfaces:**
- Consumes: existing `ArticleSchema`, `SetupPresetsSchema`.
- Produces: `ArticleVideoSchema` (Zod), `type ArticleVideo = { video_id: string; title: string; section_heading: string }`, `ArticleSchema.shape.video` (`ArticleVideo | null`, defaults `null`), `SetupPresetsSchema` engagement gains `include_youtube_video: boolean` (defaults `true`). Both exported from `@shared/schemas` via the existing `export *` index.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schemas/tests/article-video.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { ArticleSchema, SetupPresetsSchema } from '../src';

const baseArticleDoc = {
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

const basePresetsDoc = {
  business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
  audience: { target: ['makers'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: 'x', internal_links: false, llm_instructions: '' },
    engagement: { image_style: 'Sketch' },
  },
};

describe('Article.video (#85)', () => {
  test('pre-#85 docs (no video key) parse with video null', () => {
    expect(ArticleSchema.parse(baseArticleDoc).video).toBeNull();
  });

  test('a stored video round-trips', () => {
    const video = { video_id: 'dQw4w9WgXcQ', title: 'Widget basics', section_heading: 'Intro' };
    expect(ArticleSchema.parse({ ...baseArticleDoc, video }).video).toEqual(video);
  });
});

describe('presets include_youtube_video (#85)', () => {
  test('pre-#85 docs default to true', () => {
    const p = SetupPresetsSchema.parse(basePresetsDoc);
    expect(p.article_preferences.engagement.include_youtube_video).toBe(true);
  });

  test('an explicit false is preserved', () => {
    const doc = {
      ...basePresetsDoc,
      article_preferences: {
        ...basePresetsDoc.article_preferences,
        engagement: { image_style: 'Sketch', include_youtube_video: false },
      },
    };
    const p = SetupPresetsSchema.parse(doc);
    expect(p.article_preferences.engagement.include_youtube_video).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- article-video`
Expected: FAIL — `video` parses as `undefined` (no such key) and `include_youtube_video` is `undefined`.

- [ ] **Step 3: Implement the schema changes**

In `packages/shared/schemas/src/article.ts`, after the `ArticleImageSchema` block, add:

```ts
/**
 * The auto-sourced YouTube embed (#85). Null means no video — toggle off, no
 * relevant result, or the (non-fatal) video step failed.
 */
export const ArticleVideoSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  // Exact H2 text the iframe embed follows in `content`.
  section_heading: z.string(),
});
export type ArticleVideo = z.infer<typeof ArticleVideoSchema>;
```

In `ArticleSchema`, after `images_status`, add:

```ts
  // YouTube embed (#85). Defaulted so pre-#85 docs still parse.
  video: ArticleVideoSchema.nullable().default(null),
```

In `packages/shared/schemas/src/presets.ts`, change the `engagement` object to:

```ts
    engagement: z.object({
      image_style: z.string(),
      // YouTube embed toggle (#85). Defaulted so pre-#85 docs parse unchanged.
      include_youtube_video: z.boolean().default(true),
    }),
```

- [ ] **Step 4: Fix the typed fixture in `apps/api/tests/merge-presets.test.ts`**

`mergePresets` takes a typed `SetupPresets`, and the defaulted field is **required** in `z.infer`, so the `base` fixture no longer typechecks. In the `base` const, change:

```ts
    engagement: { image_style: 'Minimal' },
```

to:

```ts
    engagement: { image_style: 'Minimal', include_youtube_video: true },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- article-video` → PASS (4 tests).
Run: `npm run check:all`
Expected: clean. If it flags other typed `SetupPresets` fixtures missing `include_youtube_video`, add `include_youtube_video: true` to those fixtures the same way (untyped `Record<string, unknown>` fixtures and LLM-JSON fixtures parsed through the schema need no change).
Run: `npm test`
Expected: PASS (scanner tests parse through `SetupPresetsSchema`, so the default fills the new field).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/schemas apps/api/tests/merge-presets.test.ts
git commit -m "[backend] schemas: Article.video + presets include_youtube_video toggle

Part of #85

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: YouTube provider client (`@shared/providers`)

**Files:**
- Create: `packages/shared/providers/src/youtube/types.ts`
- Create: `packages/shared/providers/src/youtube/client.ts`
- Modify: `packages/shared/providers/src/index.ts`
- Test: `packages/shared/providers/tests/youtube.test.ts` (new)

**Interfaces:**
- Consumes: `ProviderError`, `categorizeProviderHttpStatus`, `isRetryableProviderError` from `packages/shared/providers/src/errors.ts` (already exported).
- Produces: `createYouTubeClient(config: YouTubeConfig): YouTubeClient` with `searchVideos(query: string, opts?: { max?: number; relevanceLanguage?: string }): Promise<YouTubeVideo[]>`; `YouTubeVideo = { video_id: string; title: string; description: string; channel: string }`. Exported from `@shared/providers`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/providers/tests/youtube.test.ts` (mirrors `image.test.ts` fetch-stubbing style):

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createYouTubeClient } from '../src';

function searchResponse(items: unknown[]) {
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const item = (videoId: string, title = 't', description = 'd', channelTitle = 'c') => ({
  id: { videoId },
  snippet: { title, description, channelTitle },
});

const client = () => createYouTubeClient({ apiKey: 'yt-test', maxRetries: 2, retryDelayMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('searchVideos', () => {
  test('sends the expected query params and normalizes items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([item('v1', 'T1', 'D1', 'C1')]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().searchVideos('best widgets');

    expect(out).toEqual([{ video_id: 'v1', title: 'T1', description: 'D1', channel: 'C1' }]);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/search');
    expect(url.searchParams.get('part')).toBe('snippet');
    expect(url.searchParams.get('type')).toBe('video');
    expect(url.searchParams.get('videoEmbeddable')).toBe('true');
    expect(url.searchParams.get('maxResults')).toBe('10');
    expect(url.searchParams.get('q')).toBe('best widgets');
    expect(url.searchParams.get('key')).toBe('yt-test');
    expect(url.searchParams.get('relevanceLanguage')).toBeNull();
  });

  test('passes relevanceLanguage and max when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().searchVideos('x', { max: 5, relevanceLanguage: 'de' });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('maxResults')).toBe('5');
    expect(url.searchParams.get('relevanceLanguage')).toBe('de');
  });

  test('drops items without a videoId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(searchResponse([item('v1'), { id: {}, snippet: {} }])),
    );
    const out = await client().searchVideos('x');
    expect(out).toHaveLength(1);
    expect(out[0]!.video_id).toBe('v1');
  });

  test('maps 403 (quota/auth) to auth and does NOT retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().searchVideos('x')).rejects.toMatchObject({
      name: 'ProviderError',
      category: 'auth',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries on 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(searchResponse([item('v2')]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().searchVideos('x');
    expect(out[0]!.video_id).toBe('v2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('error messages never contain the API key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 400 })));
    await expect(client().searchVideos('x')).rejects.toSatisfy(
      (e: Error) => !e.message.includes('yt-test'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- youtube`
Expected: FAIL — `createYouTubeClient` is not exported.

- [ ] **Step 3: Implement the client**

Create `packages/shared/providers/src/youtube/types.ts`:

```ts
export interface YouTubeConfig {
  apiKey: string;
  /** Defaults to 'https://www.googleapis.com/youtube/v3'. */
  baseUrl?: string;
  /** Per-request timeout. Default 15000ms. */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 200. */
  retryDelayMs?: number;
}

export interface YouTubeSearchOpts {
  /** Max results (YouTube caps at 50). Default 10. */
  max?: number;
  /** ISO 639-1 code for search.list relevanceLanguage; omitted when undefined. */
  relevanceLanguage?: string;
}

/** Normalized search.list video result. */
export interface YouTubeVideo {
  video_id: string;
  title: string;
  description: string;
  channel: string;
}

export interface YouTubeClient {
  searchVideos(query: string, opts?: YouTubeSearchOpts): Promise<YouTubeVideo[]>;
}
```

Create `packages/shared/providers/src/youtube/client.ts`:

```ts
import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../errors';
import type { YouTubeClient, YouTubeConfig, YouTubeSearchOpts, YouTubeVideo } from './types';

const DEFAULT_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;
const DEFAULT_MAX_RESULTS = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createYouTubeClient(config: YouTubeConfig): YouTubeClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  /**
   * One GET to /search. The API key travels in the query string, so error
   * messages never include the URL.
   */
  async function once(params: URLSearchParams): Promise<YouTubeVideo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/search?${params}`, { signal: controller.signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderError('timeout', 'YouTube request timed out (timeout)');
      }
      throw new ProviderError('network', 'YouTube request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const category = categorizeProviderHttpStatus(res.status);
      throw new ProviderError(category, `YouTube request failed (${category})`);
    }

    const json = (await res.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: { title?: string; description?: string; channelTitle?: string };
      }>;
    };
    return (json.items ?? [])
      .filter((item) => typeof item.id?.videoId === 'string' && item.id.videoId !== '')
      .map((item) => ({
        video_id: String(item.id?.videoId),
        title: String(item.snippet?.title ?? ''),
        description: String(item.snippet?.description ?? ''),
        channel: String(item.snippet?.channelTitle ?? ''),
      }));
  }

  return {
    async searchVideos(query: string, opts?: YouTubeSearchOpts): Promise<YouTubeVideo[]> {
      const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        maxResults: String(opts?.max ?? DEFAULT_MAX_RESULTS),
        q: query,
        key: config.apiKey,
      });
      if (opts?.relevanceLanguage) params.set('relevanceLanguage', opts.relevanceLanguage);

      let attempt = 0;
      // Loop: initial try + up to maxRetries retries on retryable categories.
      for (;;) {
        try {
          return await once(params);
        } catch (err) {
          const retryable = err instanceof ProviderError && isRetryableProviderError(err.category);
          if (!retryable || attempt >= maxRetries) throw err;
          await sleep(retryDelayMs * 2 ** attempt);
          attempt += 1;
        }
      }
    },
  };
}
```

Add to `packages/shared/providers/src/index.ts` (Biome will keep the list sorted):

```ts
export * from './youtube/client';
export type * from './youtube/types';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- youtube`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/providers
git commit -m "[backend] providers: YouTube Data API v3 search client

Part of #85

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Generation helpers (`@shared/generation/src/video.ts`)

**Files:**
- Create: `packages/shared/generation/src/video.ts`
- Modify: `packages/shared/generation/src/images.ts` (extract `injectBlockAfterHeading`)
- Modify: `packages/shared/generation/src/index.ts`
- Test: `packages/shared/generation/tests/video.test.ts` (new)

**Interfaces:**
- Consumes: `LlmMessage` type from `@shared/providers`; `parseJsonObject` from `./json`.
- Produces (all exported from `@shared/generation`):
  - `buildVideoPickPrompt(input: VideoPickInput): LlmMessage[]` where `VideoPickInput = { articleTitle: string; metaDescription: string; headings: string[]; candidates: { title: string; description: string; channel: string }[] }`
  - `parseVideoPick(text: string, candidateCount: number, headings: string[]): { video_index: number; section_heading: string } | null`
  - `buildVideoEmbed(videoId: string, title: string): string`
  - `languageCodeFromName(name: string): string | undefined`
  - `injectBlockAfterHeading(content: string, heading: string, block: string): string` (shared with images; `injectImageAfterHeading` keeps its signature and delegates)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/generation/tests/video.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  buildVideoEmbed,
  buildVideoPickPrompt,
  injectBlockAfterHeading,
  languageCodeFromName,
  parseVideoPick,
} from '../src';

const headings = ['Intro', 'Deep Dive'];

describe('buildVideoPickPrompt', () => {
  test('numbers candidates from 0 and includes article surface + sections', () => {
    const [system, user] = buildVideoPickPrompt({
      articleTitle: 'Best Widgets',
      metaDescription: 'All about widgets.',
      headings,
      candidates: [
        { title: 'Widgets 101', description: 'intro vid', channel: 'WidgetCo' },
        { title: 'Advanced widgets', description: 'deep', channel: 'Maker' },
      ],
    });
    expect(system!.role).toBe('system');
    expect(system!.content).toContain('"video_index"');
    expect(user!.content).toContain('Best Widgets');
    expect(user!.content).toContain('Intro | Deep Dive');
    expect(user!.content).toContain('0. Widgets 101');
    expect(user!.content).toContain('1. Advanced widgets');
  });
});

describe('parseVideoPick', () => {
  test('returns the pick when index and heading are valid', () => {
    const pick = parseVideoPick(
      '{"video_index": 1, "section_heading": "Deep Dive"}',
      2,
      headings,
    );
    expect(pick).toEqual({ video_index: 1, section_heading: 'Deep Dive' });
  });

  test('returns null when the LLM picks no video', () => {
    expect(parseVideoPick('{"video_index": null, "section_heading": null}', 2, headings)).toBeNull();
  });

  test('throws on an out-of-range index', () => {
    expect(() =>
      parseVideoPick('{"video_index": 5, "section_heading": "Intro"}', 2, headings),
    ).toThrow(/out of range/);
  });

  test('throws on an unknown heading', () => {
    expect(() =>
      parseVideoPick('{"video_index": 0, "section_heading": "Nope"}', 2, headings),
    ).toThrow(/unknown heading/);
  });
});

describe('buildVideoEmbed', () => {
  test('builds a nocookie iframe with an escaped title', () => {
    const html = buildVideoEmbed('v1', 'Tom & "Jerry" <3');
    expect(html).toContain('https://www.youtube-nocookie.com/embed/v1');
    expect(html).toContain('title="Tom &amp; &quot;Jerry&quot; &lt;3"');
    expect(html).toContain('allowfullscreen');
  });
});

describe('injectBlockAfterHeading', () => {
  test('inserts the block right after the matching H2', () => {
    const out = injectBlockAfterHeading('## Intro\n\ntext', 'Intro', '<iframe/>');
    expect(out).toBe('## Intro\n\n<iframe/>\n\ntext');
  });

  test('throws when the heading is missing', () => {
    expect(() => injectBlockAfterHeading('## Other\n', 'Intro', 'x')).toThrow(/heading not found/);
  });
});

describe('languageCodeFromName', () => {
  test('maps common names, passes through 2-letter codes, undefined otherwise', () => {
    expect(languageCodeFromName('English')).toBe('en');
    expect(languageCodeFromName('  turkish ')).toBe('tr');
    expect(languageCodeFromName('DE')).toBe('de');
    expect(languageCodeFromName('Global (English)')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/shared/generation/tests/video`
Expected: FAIL — none of the functions are exported.

- [ ] **Step 3: Extract `injectBlockAfterHeading` in `images.ts`**

In `packages/shared/generation/src/images.ts`, replace the existing `injectImageAfterHeading` function (lines 81–95) with:

```ts
/** Insert a markdown/HTML block right after the `## heading` line. Throws when missing. */
export function injectBlockAfterHeading(content: string, heading: string, block: string): string {
  const lines = content.split('\n');
  const idx = lines.findIndex(
    (l) => /^##\s+/.test(l) && l.replace(/^##\s+/, '').trim() === heading,
  );
  if (idx === -1) throw new Error(`heading not found in content: ${heading}`);
  lines.splice(idx + 1, 0, '', block);
  return lines.join('\n');
}

/** Insert `![alt](url)` right after the `## heading` line. Throws when missing. */
export function injectImageAfterHeading(
  content: string,
  heading: string,
  alt: string,
  url: string,
): string {
  return injectBlockAfterHeading(content, heading, `![${alt}](${url})`);
}
```

- [ ] **Step 4: Create `packages/shared/generation/src/video.ts`**

```ts
import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';

/** Inputs for the video-pick prompt — the article surface + search candidates (#85). */
export interface VideoPickInput {
  articleTitle: string;
  metaDescription: string;
  headings: string[];
  candidates: { title: string; description: string; channel: string }[];
}

export const VideoPickSchema = z.object({
  video_index: z.number().int().nullable(),
  section_heading: z.string().nullable(),
});

export function buildVideoPickPrompt(input: VideoPickInput): LlmMessage[] {
  const system = [
    'You choose one YouTube video to embed in a blog article, or none.',
    'Respond with ONLY a JSON object of this shape:',
    '{ "video_index": number | null, "section_heading": string | null }',
    'Rules: video_index is the 0-based index of the most relevant candidate, or null',
    'when no candidate is genuinely relevant to the article — prefer null over a weak',
    'match. When video_index is set, section_heading MUST be copied EXACTLY from the',
    'provided section list: the section the video best supports.',
  ].join('\n');

  const user = [
    `Article title: ${input.articleTitle}`,
    `Article summary: ${input.metaDescription}`,
    `Sections: ${input.headings.join(' | ')}`,
    'Candidates:',
    ...input.candidates.map((c, i) => `${i}. ${c.title} — ${c.channel} — ${c.description}`),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Parse + validate a pick. Returns null when the LLM chose no video; throws on
 * an out-of-range index or a heading not present in the article.
 */
export function parseVideoPick(
  text: string,
  candidateCount: number,
  headings: string[],
): { video_index: number; section_heading: string } | null {
  const pick = VideoPickSchema.parse(parseJsonObject(text));
  if (pick.video_index === null) return null;
  if (pick.video_index < 0 || pick.video_index >= candidateCount)
    throw new Error(`video pick index out of range: ${pick.video_index}`);
  if (pick.section_heading === null || !headings.includes(pick.section_heading))
    throw new Error(`video pick references unknown heading: ${pick.section_heading}`);
  return { video_index: pick.video_index, section_heading: pick.section_heading };
}

/** Minimal HTML attribute escaping for the iframe title. */
function escapeAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

/** Privacy-enhanced YouTube embed markup, injected into the article markdown (#85). */
export function buildVideoEmbed(videoId: string, title: string): string {
  return (
    `<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${videoId}" ` +
    `title="${escapeAttr(title)}" frameborder="0" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
  );
}

/**
 * Best-effort ISO 639-1 code from the free-form presets language name —
 * search.list relevanceLanguage requires a code; return undefined (param
 * omitted) when unmappable.
 */
const LANGUAGE_CODES: Record<string, string> = {
  arabic: 'ar',
  chinese: 'zh',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  spanish: 'es',
  swedish: 'sv',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  vietnamese: 'vi',
};

export function languageCodeFromName(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(n)) return n;
  return LANGUAGE_CODES[n];
}
```

Add to `packages/shared/generation/src/index.ts`: add `injectBlockAfterHeading` to the existing `./images` export list, and:

```ts
export type { VideoPickInput } from './video';
export {
  buildVideoEmbed,
  buildVideoPickPrompt,
  languageCodeFromName,
  parseVideoPick,
  VideoPickSchema,
} from './video';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- packages/shared/generation/tests/video`
Expected: PASS (10 tests).
Run: `npm test -- packages/shared/generation` and `npm test -- apps/worker/tests/images`
Expected: PASS — the `injectImageAfterHeading` refactor must not change behavior.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add packages/shared/generation
git commit -m "[backend] generation: video pick prompt, embed builder, shared heading injection

Part of #85

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Generation worker integration

**Files:**
- Modify: `apps/worker/src/providers.ts` (`getGenerationClients` gains `youtube`)
- Modify: `apps/worker/src/generation.ts` (video step between validation and persist)
- Test: `apps/worker/tests/generation.test.ts` (extend)

**Interfaces:**
- Consumes: `createYouTubeClient` (Task 2); `buildVideoEmbed`, `buildVideoPickPrompt`, `extractH2s`, `injectBlockAfterHeading`, `languageCodeFromName`, `parseVideoPick` from `@shared/generation` (Task 3); `ArticleVideo` type (Task 1); `YOUTUBE_API_KEY` env var.
- Produces: articles persisted with `video` set (or `null`) and the iframe injected in `content`.

- [ ] **Step 1: Update the test file — mocks and fixtures**

In `apps/worker/tests/generation.test.ts`:

Replace the providers mock (line 31) with:

```ts
const { llmComplete, searchVideos } = vi.hoisted(() => ({
  llmComplete: vi.fn(),
  searchVideos: vi.fn(async () => [] as unknown[]),
}));
vi.mock('../src/providers', () => ({
  getGenerationClients: () => ({ llm: { complete: llmComplete }, youtube: { searchVideos } }),
}));
```

In the `org` fixture, change the engagement line to:

```ts
      engagement: { image_style: '', include_youtube_video: true },
```

After the `okArticle` fixture, add a variant whose content has an H2 (the video step skips content without H2s):

```ts
const okArticleWithSection = {
  ok: true,
  article: {
    ...okArticle.article,
    content: '# body\n\n## Section One\n\ntext',
  },
};

const candidate = { video_id: 'v1', title: 'Widget basics', description: 'd', channel: 'c' };
const pickJson = (text: string) => ({
  text,
  model: 'm',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
});
```

- [ ] **Step 2: Add the failing tests**

Append inside the `describe('generation worker', ...)` block:

```ts
  test('embeds a picked YouTube video: iframe in content + structured video field', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);
    searchVideos.mockResolvedValueOnce([candidate]);
    llmComplete.mockResolvedValueOnce(
      pickJson('{"video_index": 0, "section_heading": "Section One"}'),
    );

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(searchVideos).toHaveBeenCalledWith('best widgets', expect.anything());
    const created = createArticle.mock.calls[0]![0] as {
      content: string;
      video: { video_id: string; section_heading: string };
    };
    expect(created.content).toContain('youtube-nocookie.com/embed/v1');
    expect(created.video).toEqual({
      video_id: 'v1',
      title: 'Widget basics',
      section_heading: 'Section One',
    });
  });

  test('toggle off: no search call, video null', async () => {
    findOrgById.mockResolvedValue({
      ...org,
      presets: {
        ...org.presets,
        article_preferences: {
          ...org.presets.article_preferences,
          engagement: { image_style: '', include_youtube_video: false },
        },
      },
    });
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(searchVideos).not.toHaveBeenCalled();
    expect((createArticle.mock.calls[0]![0] as { video: unknown }).video).toBeNull();
  });

  test('video step failure is non-fatal: article persists with video null', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);
    searchVideos.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(
      handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {}),
    ).resolves.toBeUndefined();

    expect((createArticle.mock.calls[0]![0] as { video: unknown }).video).toBeNull();
    expect(failGeneration).not.toHaveBeenCalled();
  });

  test('LLM picking no video leaves content untouched', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);
    searchVideos.mockResolvedValueOnce([candidate]);
    llmComplete.mockResolvedValueOnce(pickJson('{"video_index": null, "section_heading": null}'));

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const created = createArticle.mock.calls[0]![0] as { content: string; video: unknown };
    expect(created.content).not.toContain('iframe');
    expect(created.video).toBeNull();
  });
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npm test -- apps/worker/tests/generation`
Expected: the 4 new tests FAIL (`video` is `undefined` on the create input, `searchVideos` never called); the 6 existing tests PASS.

- [ ] **Step 4: Implement the worker changes**

In `apps/worker/src/providers.ts`, add `createYouTubeClient` to the `@shared/providers` import and change `getGenerationClients` to:

```ts
/** Build the LLM + YouTube clients the generation worker needs, from env (#55/#85). */
export function getGenerationClients() {
  return {
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
    youtube: createYouTubeClient({ apiKey: process.env.YOUTUBE_API_KEY ?? '' }),
  };
}
```

In `apps/worker/src/generation.ts`:

Change the imports:

```ts
import {
  buildContext,
  buildVideoEmbed,
  buildVideoPickPrompt,
  extractH2s,
  generateArticle,
  injectBlockAfterHeading,
  languageCodeFromName,
  parseVideoPick,
} from '@shared/generation';
import type { ArticleVideo } from '@shared/schemas';
import { GenerateTask, isPaid } from '@shared/schemas';
```

Change `const { llm } = getGenerationClients();` to:

```ts
      const { llm, youtube } = getGenerationClients();
```

Between the validation-failure `continue` and `ArticleRepo.create`, add:

```ts
      // YouTube embed (#85): best-effort — any failure logs and the article
      // ships without a video; never fail or delay generation over this.
      let content = result.article.content;
      let video: ArticleVideo | null = null;
      if (org.presets.article_preferences.engagement.include_youtube_video) {
        try {
          const headings = extractH2s(content);
          const candidates =
            headings.length > 0
              ? await youtube.searchVideos(keyword.keyword, {
                  relevanceLanguage: languageCodeFromName(org.presets.business.language),
                })
              : [];
          if (candidates.length > 0) {
            const res = await llm.complete({
              messages: buildVideoPickPrompt({
                articleTitle: result.article.title,
                metaDescription: result.article.meta_description,
                headings,
                candidates,
              }),
              responseFormat: 'json',
            });
            const pick = parseVideoPick(res.text, candidates.length, headings);
            if (pick) {
              const chosen = candidates[pick.video_index]!;
              content = injectBlockAfterHeading(
                content,
                pick.section_heading,
                buildVideoEmbed(chosen.video_id, chosen.title),
              );
              video = {
                video_id: chosen.video_id,
                title: chosen.title,
                section_heading: pick.section_heading,
              };
            }
          }
        } catch (err) {
          logger.warn('video step failed; article ships without video', { error: err as Error });
        }
      }
```

In the `ArticleRepo.create` call, change `content: result.article.content,` to `content,` and add `video,` after it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- apps/worker/tests/generation`
Expected: PASS (10 tests). Note the pre-existing tests use `okArticle` whose content has no H2, so the video step skips searching — they stay green without touching their assertions.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add apps/worker
git commit -m "[backend] worker: non-fatal YouTube embed step in article generation

Part of #85

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: API exposure — `video` on the article detail response

**Files:**
- Modify: `apps/api/src/schemas/dashboard.ts` (`ArticleDetailResponse` gains `video`)
- Modify: `apps/api/src/routes/dashboard.ts` (`toArticleDetail` maps it)
- Test: `apps/api/tests/dashboard.test.ts` (extend fixtures + detail test)

**Interfaces:**
- Consumes: `ArticleVideoSchema` from `@shared/schemas` (Task 1).
- Produces: `GET /api/v0/dashboard/articles/{id}` responses include `video: { video_id, title, section_heading } | null` — flows into the typed client for the frontend.

- [ ] **Step 1: Extend the test**

In `apps/api/tests/dashboard.test.ts`, add `video` to the article fixtures: on `art_1` (after `published_at: null,`):

```ts
      video: { video_id: 'v1', title: 'Widget basics', section_heading: 'Intro' },
```

and on `art_2` and `art_3`:

```ts
      video: null,
```

In the `GET /articles/:id` test, inside the `if (ok.status === 200)` block, add:

```ts
      expect(body.video).toEqual({
        video_id: 'v1',
        title: 'Widget basics',
        section_heading: 'Intro',
      });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- apps/api/tests/dashboard`
Expected: the `/articles/:id` test FAILS — `body.video` is `undefined` (and typecheck of the assertion fails until the schema gains the field; that is the point).

- [ ] **Step 3: Implement**

In `apps/api/src/schemas/dashboard.ts`, add `ArticleVideoSchema` to the `@shared/schemas` import, and in `ArticleDetailResponse` after `published_at`:

```ts
    // Auto-sourced YouTube embed (#85); the iframe is also in `content`.
    video: ArticleVideoSchema.nullable(),
```

In `apps/api/src/routes/dashboard.ts` `toArticleDetail`, after `published_at: ...`, add:

```ts
    video: a.video,
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- apps/api/tests/dashboard`
Expected: PASS.
Run: `npm run check:all`
Expected: clean — `video` is additive on the response, so the web app's typed client keeps compiling. The settings surfaces (`ArticlesSettingsResponse`, `ArticlesSettingsPatchBody`, `GET/PATCH /setup/*`) derive from `SetupPresetsSchema.shape`, so `include_youtube_video` flows through them with **no code change**.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add apps/api
git commit -m "[backend] api: expose article video on the detail response

Part of #85

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Env/infra plumbing, docs, and final verification

**Files:**
- Modify: `infra/lib/api-stack.ts` (generation worker env gains `YOUTUBE_API_KEY`)
- Modify: `.env.example`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `YOUTUBE_API_KEY` read by `getGenerationClients` (Task 4).
- Produces: deployed generation worker receives the key; local dev documents it.

- [ ] **Step 1: CDK wiring**

In `infra/lib/api-stack.ts`, in the `generationWorkerFn` `environment` block, after `OPENROUTER_API_KEY: ...`, add:

```ts
        YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY ?? '',
```

(Same synth-time provider-secret pattern as `FAL_KEY`; SSM provisioning of the real value stays manual/deferred — #9/#43. Only the generation worker gets the key.)

- [ ] **Step 2: `.env.example`**

After the `FAL_KEY=` line, add:

```
YOUTUBE_API_KEY=
```

- [ ] **Step 3: `PROGRESS.md`**

Under the Dashboard section, after the article-generation/images line, add one line:

```markdown
- ✅ YouTube video embedding — generation worker sources a relevant video (YouTube Data API v3) via LLM pick, injects a nocookie iframe + stores `article.video`; presets toggle `engagement.include_youtube_video` — [#85](https://github.com/seopotion/seo/issues/85). Real `YOUTUBE_API_KEY` provisioning manual ([#9](https://github.com/seopotion/seo/issues/9)/[#43](https://github.com/seopotion/seo/issues/43))
```

- [ ] **Step 4: Full verification**

Run, in order, and confirm each passes before claiming done:

```bash
npm run lint
npm run check:all
npm test
```

Note: `infra/` is a standalone package — if `infra/node_modules` is present, `cd infra && npx tsc --noEmit` too; otherwise CI covers it.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/api-stack.ts .env.example PROGRESS.md
git commit -m "[infra] YOUTUBE_API_KEY env for the generation worker; docs

Part of #85

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and open the PR into `dev`**

```bash
git push -u origin ozykhan/youtube-video-embedding
gh pr create --base dev --title "[backend] YouTube video embedding in generated articles" --body "$(cat <<'EOF'
Implements design/article-youtube-video.md.

- New `@shared/providers` YouTube Data API v3 search client (`YOUTUBE_API_KEY`, generation worker only)
- Generation worker: non-fatal video step — search by keyword, LLM picks candidate + target H2 (or none), injects a youtube-nocookie iframe, stores structured `article.video`
- Presets: `engagement.include_youtube_video` (default true) — flows through existing settings/setup surfaces
- API: `video` on the article detail response
- Quota posture: ~100 searches/day free; over-quota or any failure ships the article with `video: null`

Real `YOUTUBE_API_KEY` value provisioning in deployed envs stays manual (#9/#43).

Closes #85

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
