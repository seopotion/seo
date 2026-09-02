import { NO_TEXT_DIRECTIVE } from '@shared/generation';
import type { ArticleImage } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  findArticleById,
  setImagePlan,
  fillImageSlot,
  completeImages,
  failImages,
  findOrgById,
  findWordPressMirror,
  listIntegrations,
  findIntegration,
  connectWordPress,
  recordPreflightError,
  clearPreflightError,
  initializeAttempt,
} = vi.hoisted(() => ({
  findArticleById: vi.fn(),
  setImagePlan: vi.fn(async (_id: string, _images: unknown[]) => true),
  fillImageSlot: vi.fn(
    async (_id: string, _index: number, _fill: unknown, _newContent: string | null) => true,
  ),
  completeImages: vi.fn(async (_id: string, _coverUrl: string) => true),
  failImages: vi.fn(async (_id: string) => {}),
  findOrgById: vi.fn(),
  findWordPressMirror: vi.fn(),
  listIntegrations: vi.fn(async (_orgId: string): Promise<unknown[]> => []),
  findIntegration: vi.fn(),
  connectWordPress: vi.fn(async () => {}),
  recordPreflightError: vi.fn(async () => {}),
  clearPreflightError: vi.fn(async () => {}),
  initializeAttempt: vi.fn(async (_id: string, _provider: string, _requestedAt?: Date) => true),
}));
vi.mock('@shared/db', () => ({
  ArticleRepo: {
    findById: findArticleById,
    setImagePlan,
    fillImageSlot,
    completeImages,
    failImages,
    recordAutoPublishPreflightError: recordPreflightError,
    clearAutoPublishPreflightError: clearPreflightError,
    initializeAutoPublishAttempt: initializeAttempt,
  },
  OrgRepo: {
    findByIdWithoutSecrets: findOrgById,
    findWordPressMirror,
  },
  IntegrationRepo: {
    listByOrgId: listIntegrations,
    findByOrgAndProvider: findIntegration,
    connectWordPress,
  },
}));

const { enqueuePublishTask } = vi.hoisted(() => ({
  enqueuePublishTask: vi.fn(async (_task: { provider: string }) => {}),
}));
vi.mock('../src/sqs', () => ({ enqueuePublishTask }));

const { storeImage } = vi.hoisted(() => ({
  storeImage: vi.fn(
    async (keyBase: string, _bytes: Uint8Array, _contentType: string, ext: string) =>
      `https://cdn.example/${keyBase}.${ext}`,
  ),
}));
vi.mock('../src/storage', () => ({ storeImage }));

vi.mock('../../../../apps/api/src/lib/secrets', () => ({
  getGscTokenKey: vi.fn(async () => Buffer.alloc(32, 1)),
}));
vi.mock('../../../../apps/api/src/lib/crypto', () => ({
  encryptSecret: vi.fn(() => 'encrypted-token'),
}));

const { llmComplete, imageGenerate } = vi.hoisted(() => ({
  llmComplete: vi.fn(),
  // Typed as the provider contract (nullable dimensions), not as the happy-path
  // literal, so tests can hand back the bad shapes fal is allowed to return.
  imageGenerate: vi.fn(
    async (
      _params: unknown,
    ): Promise<{
      images: { url: string; width: number | null; height: number | null }[];
      seed: number | null;
    }> => ({
      images: [{ url: 'https://fal.media/img.webp', width: 1200, height: 624 }],
      seed: 7,
    }),
  ),
}));

import { ArticleFatalError, ArticleRetryableError } from '../src/errors';
import { stageHandoffPublish } from '../src/stages/handoff';
import { stageImagesPlan, stageImagesRender } from '../src/stages/images';
import { makeRun, presets } from './fixtures';

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

const usageStub = { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 };

const planJson = JSON.stringify({
  medium: 'flat_illustration',
  cover: {
    subject: 'the cover idea',
    composition: 'still_life',
    lighting: 'soft_studio',
    palette: 'teal and sand',
    objects: ['brass gear'],
    alt: 'cover alt',
  },
  inline: [
    {
      subject: 's1',
      composition: 'macro',
      lighting: 'natural_daylight',
      palette: '',
      objects: ['coiled cable'],
      alt: 'alt one',
      section_heading: 'First Section',
    },
    {
      subject: 's2',
      composition: 'abstract',
      lighting: 'cool_ambient',
      palette: '',
      objects: [],
      alt: 'alt two',
      section_heading: 'Second Section',
    },
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
// Factory, not a shared const, so slot objects never leak between tests.
const plannedSlots = (): ArticleImage[] => [
  slot({ role: 'cover', prompt: 'cover scene', alt: 'cover alt' }),
  slot({ prompt: 'p1', alt: 'alt one', section_heading: 'First Section' }),
  slot({ prompt: 'p2', alt: 'alt two', section_heading: 'Second Section' }),
];

const filledSlots = (ext = 'webp'): ArticleImage[] =>
  plannedSlots().map((s, i) => ({
    ...s,
    url: `https://cdn.example/articles/a1/${i === 0 ? 'cover' : `inline-${i}`}.${ext}`,
    width: 1200,
    height: 624,
  }));

const run = makeRun({ working: { article_id: 'a1' } });

beforeEach(() => {
  vi.clearAllMocks();
  findArticleById.mockReset();
  findOrgById.mockReset();
  findWordPressMirror.mockReset().mockResolvedValue(null);
  listIntegrations.mockReset().mockResolvedValue([]);
  findIntegration.mockReset().mockResolvedValue(null);
  enqueuePublishTask.mockReset().mockResolvedValue(undefined);
  fillImageSlot.mockReset().mockResolvedValue(true);
  imageGenerate.mockReset().mockResolvedValue({
    images: [{ url: 'https://fal.media/img.webp', width: 1200, height: 624 }],
    seed: 7,
  });
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

describe('stageImagesPlan', () => {
  test('throws ArticleFatalError when working.article_id is not checkpointed', async () => {
    await expect(stageImagesPlan(makeRun(), { complete: llmComplete })).rejects.toThrow(
      ArticleFatalError,
    );
  });

  test('throws ArticleFatalError when the article is not found', async () => {
    findArticleById.mockResolvedValue(null);
    await expect(stageImagesPlan(run, { complete: llmComplete })).rejects.toThrow(
      ArticleFatalError,
    );
  });

  test('set-if-absent: no LLM call when the article already has a plan', async () => {
    findArticleById.mockResolvedValue({ ...article, images: plannedSlots() });

    const result = await stageImagesPlan(run, { complete: llmComplete });

    expect(llmComplete).not.toHaveBeenCalled();
    expect(setImagePlan).not.toHaveBeenCalled();
    expect(result).toEqual({ completed: true, working: {} });
  });

  test('plans from run.input.presets, not an OrgRepo fetch', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    llmComplete.mockResolvedValue({
      text: planJson,
      model: 'm',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 },
    });

    const result = await stageImagesPlan(run, { complete: llmComplete });

    expect(findOrgById).not.toHaveBeenCalled();
    expect(setImagePlan).toHaveBeenCalledTimes(1);
    const slots = setImagePlan.mock.calls[0]![1] as ArticleImage[];
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ role: 'cover', section_heading: null, url: '' });
    expect(slots[1]).toMatchObject({ role: 'inline', section_heading: 'First Section' });
    expect(result).toEqual({ completed: true, working: {} });
  });

  // #289: the planner names objects and the prompt is assembled here, so a
  // request for a diagram cannot reach the image model however it is phrased.
  // #309: the org's style and the planned composition shape that prompt.
  test('builds each prompt from the medium, composition and objects, never from planner prose', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    llmComplete.mockResolvedValue({ text: planJson, model: 'm', usage: usageStub });

    await stageImagesPlan(run, { complete: llmComplete });

    expect(llmComplete).toHaveBeenCalledTimes(1);
    const slots = setImagePlan.mock.calls[0]![1] as ArticleImage[];
    expect(slots[0]!.prompt).toContain(
      'A flat vector illustration of brass gear, arranged on a plain surface.',
    );
    expect(slots[0]!.prompt).toContain('Palette: teal and sand.');
    expect(slots[0]!.prompt).toContain('not a document, page, poster, slide, chart or screen');
    expect(slots[0]!.alt).toBe('cover alt');
    expect(slots[1]!.prompt).toContain('an extreme close-up of coiled cable');
    expect(slots[2]!.prompt).toContain('abstract shapes, light and texture evoking s2');
  });

  test('objects that carry writing are dropped, downgrading the slot to abstract', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    llmComplete.mockResolvedValue({
      text: JSON.stringify({
        medium: 'photograph',
        cover: {
          subject: 'release pipelines',
          composition: 'still_life',
          lighting: 'natural_daylight',
          palette: '',
          objects: ['architecture diagram', 'deployment badge'],
          alt: 'cover alt',
        },
        inline: [
          {
            subject: 's1',
            composition: 'macro',
            lighting: 'natural_daylight',
            palette: '',
            objects: ['coiled cable'],
            alt: 'a1',
            section_heading: 'First Section',
          },
          {
            subject: 's2',
            composition: 'environment',
            lighting: 'natural_daylight',
            palette: '',
            objects: ['stone tile'],
            alt: 'a2',
            section_heading: 'Second Section',
          },
        ],
      }),
      model: 'm',
      usage: usageStub,
    });

    await stageImagesPlan(run, { complete: llmComplete });

    const slots = setImagePlan.mock.calls[0]![1] as ArticleImage[];
    expect(slots[0]!.prompt).toContain('evoking release pipelines');
    expect(slots[0]!.prompt).not.toContain('diagram');
    expect(slots[0]!.prompt).not.toContain('badge');
  });

  test('invalid plan marks images failed and rethrows', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });
    llmComplete.mockResolvedValue({
      text: JSON.stringify({
        medium: 'photograph',
        cover: {
          subject: 's',
          composition: 'abstract',
          lighting: 'natural_daylight',
          palette: '',
          objects: [],
          alt: 'a',
        },
        inline: [],
      }),
      model: 'm',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 },
    });

    await expect(stageImagesPlan(run, { complete: llmComplete })).rejects.toThrow(/exactly/);
    expect(failImages).toHaveBeenCalledWith('a1');
  });
});

describe('stageImagesRender', () => {
  test('throws ArticleFatalError when working.article_id is not checkpointed', async () => {
    await expect(stageImagesRender(makeRun(), { generate: imageGenerate })).rejects.toThrow(
      ArticleFatalError,
    );
  });

  test('throws ArticleFatalError when the article is not found', async () => {
    findArticleById.mockResolvedValue(null);
    await expect(stageImagesRender(run, { generate: imageGenerate })).rejects.toThrow(
      ArticleFatalError,
    );
  });

  test('sends the planned prompt with the no-text directive appended', async () => {
    findArticleById
      .mockResolvedValueOnce({ ...article, images: plannedSlots() })
      .mockResolvedValue({ ...article, images: filledSlots() });

    await stageImagesRender(run, { generate: imageGenerate });

    for (const call of imageGenerate.mock.calls) {
      expect((call[0] as { prompt: string }).prompt).toContain(NO_TEXT_DIRECTIVE);
    }
  });

  test('short-circuits when images_status is already complete', async () => {
    findArticleById.mockResolvedValue({ ...article, images_status: 'complete' });

    const result = await stageImagesRender(run, { generate: imageGenerate });

    expect(imageGenerate).not.toHaveBeenCalled();
    expect(result).toEqual({ completed: true, working: {} });
  });

  test('throws ArticleRetryableError when the image plan is missing', async () => {
    findArticleById.mockResolvedValue({ ...article, images: [] });

    await expect(stageImagesRender(run, { generate: imageGenerate })).rejects.toThrow(
      new ArticleRetryableError('image plan missing'),
    );
    expect(imageGenerate).not.toHaveBeenCalled();
  });

  test('resumes at the first unfilled slot, skipping the already-filled cover', async () => {
    const slots = plannedSlots();
    const partial = [
      { ...slots[0]!, url: 'https://cdn.example/articles/a1/cover.png' },
      slots[1]!,
      slots[2]!,
    ];
    findArticleById.mockResolvedValue({ ...article, images: partial });

    const result = await stageImagesRender(run, { generate: imageGenerate });

    expect(imageGenerate).toHaveBeenCalledTimes(2); // only the two inline slots
    expect(completeImages).toHaveBeenCalledWith('a1', 'https://cdn.example/articles/a1/cover.png');
    expect(result).toEqual({ completed: true, working: {} });
  });

  test('losing a fill race adopts the winner-persisted slot and content', async () => {
    const WINNER_COVER = 'https://cdn.example/articles/a1/cover-beefbeefbeefbeef.webp';
    const won = plannedSlots();
    won[0] = { ...won[0]!, url: WINNER_COVER, width: 1200, height: 630 };
    const complete = filledSlots().map((s, i) => (i === 0 ? { ...s, url: WINNER_COVER } : s));
    // Still has the H2s, so the next inline injection has somewhere to land.
    const winnerContent = content.replace('intro', 'WINNER INTRO');
    findArticleById
      .mockResolvedValueOnce({ ...article, images: plannedSlots() })
      .mockResolvedValueOnce({ ...article, images: won, content: winnerContent })
      .mockResolvedValueOnce({ ...article, images: complete });
    fillImageSlot.mockResolvedValueOnce(false); // cover: another delivery got there first

    await stageImagesRender(run, { generate: imageGenerate });

    // The loser's own cover URL is never published...
    expect(completeImages).toHaveBeenCalledWith('a1', WINNER_COVER);
    // ...and the next inline injection builds on the winner's content, not
    // on a local copy that never reached the database.
    expect(fillImageSlot.mock.calls[1]![3]).toContain('WINNER INTRO');
  });

  test('throws if the slot is still unfilled after losing the fill race', async () => {
    findArticleById
      .mockResolvedValueOnce({ ...article, images: plannedSlots() })
      .mockResolvedValueOnce({ ...article, images: plannedSlots() }); // still empty
    fillImageSlot.mockResolvedValueOnce(false);

    await expect(stageImagesRender(run, { generate: imageGenerate })).rejects.toThrow(
      /unfilled after losing the fill race/,
    );
    expect(completeImages).not.toHaveBeenCalled();
  });

  test.each([
    ['a null width', { width: null, height: 630 }],
    ['a null height', { width: 1200, height: null }],
    ['a zero width', { width: 0, height: 630 }],
    ['a negative height', { width: 1200, height: -630 }],
    ['a fractional width', { width: 1200.5, height: 630 }],
  ])('rejects %s without storing or persisting anything', async (_label, dims) => {
    findArticleById.mockResolvedValue({ ...article, images: plannedSlots() });
    imageGenerate.mockResolvedValueOnce({
      images: [{ url: 'https://fal.media/img.webp', ...dims }],
      seed: 7,
    });

    await expect(stageImagesRender(run, { generate: imageGenerate })).rejects.toThrow(
      /invalid (width|height)/,
    );
    expect(storeImage).not.toHaveBeenCalled();
    expect(fillImageSlot).not.toHaveBeenCalled();
    expect(completeImages).not.toHaveBeenCalled();
  });
});

describe('stageHandoffPublish', () => {
  const enabledPresets = {
    ...presets,
    article_preferences: {
      ...presets.article_preferences,
      publishing: { auto_publish: true },
    },
  };
  const handoffRun = makeRun({ working: { article_id: 'a1' }, presets: enabledPresets });
  const org = {
    id: 'o1',
    plan: 'paid',
    website_url: 'https://x.com',
    presets: enabledPresets,
  };
  const completeArticle = { ...article, images_status: 'complete' as const };
  const wordpress = {
    id: 'i-wp',
    org_id: 'o1',
    provider: 'wordpress' as const,
    site_url: 'https://x.com',
    token_enc: 'enc',
    connected_at: new Date(),
    last_error: null,
  };
  const staticSite = {
    id: 'i-static',
    org_id: 'o1',
    provider: 'static-site' as const,
    host: 'github' as const,
    installation_id: 1,
    repo: 'o/r',
    branch: 'main',
    content_path: 'seopotion/',
    connected_at: new Date(),
    last_error: null,
  };

  test('throws ArticleFatalError when working.article_id is not checkpointed', async () => {
    await expect(stageHandoffPublish(makeRun())).rejects.toThrow(ArticleFatalError);
  });

  test('throws ArticleFatalError when the article is not found', async () => {
    findArticleById.mockResolvedValue(null);
    await expect(stageHandoffPublish(handoffRun)).rejects.toThrow(ArticleFatalError);
  });

  test('returns quietly when images are not complete yet', async () => {
    findArticleById.mockResolvedValue({ ...article, images_status: 'pending' });
    findOrgById.mockResolvedValue(org);

    const result = await stageHandoffPublish(handoffRun);

    expect(result).toEqual({ completed: true, working: {} });
    expect(listIntegrations).not.toHaveBeenCalled();
  });

  test('returns quietly when auto_publish is off', async () => {
    findArticleById.mockResolvedValue(completeArticle);
    findOrgById.mockResolvedValue({ ...org, presets }); // default fixture presets: auto_publish false

    const result = await stageHandoffPublish(handoffRun);

    expect(result).toEqual({ completed: true, working: {} });
    expect(listIntegrations).not.toHaveBeenCalled();
  });

  test('enqueues one PublishTask per connected provider', async () => {
    findArticleById.mockResolvedValue(completeArticle);
    findOrgById.mockResolvedValue(org);
    listIntegrations.mockResolvedValue([wordpress, staticSite]);

    const result = await stageHandoffPublish(handoffRun);

    expect(initializeAttempt.mock.calls.map((call) => call[1])).toEqual([
      'wordpress',
      'static-site',
    ]);
    expect(enqueuePublishTask.mock.calls.map((call) => call[0].provider)).toEqual([
      'wordpress',
      'static-site',
    ]);
    expect(clearPreflightError).toHaveBeenCalledWith('a1');
    expect(result).toEqual({ completed: true, working: {} });
  });

  test('records an actionable preflight error when no integrations exist', async () => {
    findArticleById.mockResolvedValue(completeArticle);
    findOrgById.mockResolvedValue(org);

    const result = await stageHandoffPublish(handoffRun);

    expect(recordPreflightError).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ code: 'not_connected', kind: 'permanent' }),
    );
    expect(enqueuePublishTask).not.toHaveBeenCalled();
    expect(result).toEqual({ completed: true, working: {} });
  });

  test('backfills a mirror-only WordPress connection before queueing', async () => {
    findArticleById.mockResolvedValue(completeArticle);
    findOrgById.mockResolvedValue({ ...org, wordpress_connected_at: new Date() });
    findWordPressMirror.mockResolvedValue({
      website_url: 'https://x.com',
      token: 'plain-token',
      connected_at: new Date(),
    });
    findIntegration.mockResolvedValue(wordpress);

    await stageHandoffPublish(handoffRun);

    expect(connectWordPress).toHaveBeenCalledWith('o1', 'https://x.com', 'encrypted-token');
    expect(enqueuePublishTask).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'wordpress' }),
    );
  });
});
