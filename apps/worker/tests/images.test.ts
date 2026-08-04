import type { SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { findArticleById, setImagePlan, fillImageSlot, completeImages, failImages, findOrgById } =
  vi.hoisted(() => ({
    findArticleById: vi.fn(),
    setImagePlan: vi.fn(async (_id: string, _images: unknown[]) => true),
    fillImageSlot: vi.fn(
      async (_id: string, _index: number, _fill: unknown, _newContent: string | null) => true,
    ),
    completeImages: vi.fn(async (_id: string, _coverUrl: string) => true),
    failImages: vi.fn(async (_id: string) => {}),
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
  imageGenerate: vi.fn(async (_params: unknown) => ({
    images: [{ url: 'https://fal.media/img.webp', width: 1200, height: 624 }],
    seed: 7,
  })),
}));
vi.mock('../src/providers', () => ({
  getImageClients: () => ({ llm: { complete: llmComplete }, image: { generate: imageGenerate } }),
}));

const { storeImage } = vi.hoisted(() => ({
  storeImage: vi.fn(
    async (key: string, _bytes: Uint8Array, _contentType: string) => `https://cdn.example/${key}`,
  ),
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
    audience: { target: ['makers'], competitors: [] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: 'x',
        internal_links_count: 0,
        table_of_contents: true,
        llm_instructions: '',
      },
      engagement: { image_style: 'flat illustration', youtube_videos: true },
      publishing: { auto_publish: false },
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
  width: null,
  height: null,
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
          headers: { 'content-type': 'image/webp' },
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

    // exact OG pixels for the cover, the same 1200px cap at 16:9 inline, WebP for both
    expect(imageGenerate).toHaveBeenCalledTimes(3);
    expect(imageGenerate.mock.calls[0]![0]).toMatchObject({
      size: { width: 1200, height: 630 },
      outputFormat: 'webp',
    });
    expect(imageGenerate.mock.calls[1]![0]).toMatchObject({
      size: { width: 1200, height: 675 },
      outputFormat: 'webp',
    });

    // deterministic keys, WebP bytes
    expect(storeImage.mock.calls.map((c) => c[0])).toEqual([
      'articles/a1/cover.webp',
      'articles/a1/inline-1.webp',
      'articles/a1/inline-2.webp',
    ]);
    expect(storeImage.mock.calls[0]![2]).toBe('image/webp');

    // inline fills carry injected markdown; cover leaves content alone
    expect(fillImageSlot).toHaveBeenCalledTimes(3);
    expect(fillImageSlot.mock.calls[0]![3]).toBeNull();
    expect(fillImageSlot.mock.calls[1]![3]).toContain(
      '![alt one](https://cdn.example/articles/a1/inline-1.webp)',
    );

    // provider-reported intrinsic pixels are persisted on every slot (#176)
    expect(fillImageSlot.mock.calls[0]![2]).toMatchObject({ width: 1200, height: 624 });
    expect(fillImageSlot.mock.calls[2]![2]).toMatchObject({ width: 1200, height: 624 });

    expect(completeImages).toHaveBeenCalledWith('a1', 'https://cdn.example/articles/a1/cover.webp');
  });

  test('keeps the key extension honest if the provider ignores the WebP request', async () => {
    findArticleById.mockResolvedValue({ ...article, images: plannedSlots() });
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

    await handler(event({ org_id: 'o1', article_id: 'a1' }), {} as never, () => {});

    expect(storeImage.mock.calls[0]![0]).toBe('articles/a1/cover.png');
    expect(storeImage.mock.calls[0]![2]).toBe('image/png');
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
