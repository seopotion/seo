import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  articleListByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
  articleFindById: vi.fn(async (): Promise<unknown> => null),
  initAttempt: vi.fn(async () => true),
  resetAttempt: vi.fn(async () => true),
  clearPreflight: vi.fn(async () => {}),
  keywordListByOrg: vi.fn(async () => [] as unknown[]),
  keywordFindById: vi.fn(async (): Promise<unknown> => null),
  orgFindById: vi.fn(async (): Promise<unknown> => null),
  orgFindByUserId: vi.fn(async () => [] as unknown[]),
  userFindByEmail: vi.fn(async (): Promise<unknown> => null),
  integrationsList: vi.fn(async () => [] as unknown[]),
  closeDb: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({
  ArticleRepo: {
    listByOrg: repos.articleListByOrg,
    findById: repos.articleFindById,
    initializeAutoPublishAttempt: repos.initAttempt,
    resetAutoPublishAttempt: repos.resetAttempt,
    clearAutoPublishPreflightError: repos.clearPreflight,
  },
  KeywordRepo: { listByOrg: repos.keywordListByOrg, findById: repos.keywordFindById },
  OrgRepo: { findById: repos.orgFindById, findByUserId: repos.orgFindByUserId },
  UserRepo: { findByEmail: repos.userFindByEmail },
  IntegrationRepo: { listByOrgId: repos.integrationsList },
  closeDb: repos.closeDb,
}));

const sqs = vi.hoisted(() => ({
  send: vi.fn(async (_cmd: { input: Record<string, unknown> }) => ({})),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send = sqs.send;
    destroy() {}
  },
  SendMessageCommand: class {
    constructor(readonly input: unknown) {}
  },
  GetQueueAttributesCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

const { launchGeneration } = vi.hoisted(() => ({
  launchGeneration: vi.fn(
    async (_orgId: string, keywordId: string): Promise<{ run_id: string } | null> => ({
      run_id: `run_${keywordId}`,
    }),
  ),
}));
vi.mock('@shared/articles', () => ({ launchGeneration }));

// The real index pulls the whole generation pipeline into the graph.
vi.mock('@shared/generation', () => ({ MAX_GENERATION_ATTEMPTS: 3 }));

import { generateNext, listArticles, publishArticle, showArticle } from '../src/lib/articles';

const attempt = (over: Record<string, unknown> = {}) => ({
  provider: 'wordpress',
  status: 'failed',
  attempt_count: 3,
  requested_at: new Date('2026-08-20T07:00:00Z'),
  last_attempt_at: new Date('2026-08-20T07:05:00Z'),
  lease_expires_at: null,
  last_error: {
    code: 'plugin_upgrade_required',
    kind: 'permanent',
    message: 'upgrade the plugin',
    at: new Date('2026-08-20T07:05:00Z'),
  },
  ...over,
});

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  org_id: 'o1',
  keyword_id: 'k1',
  title: 'Widget Guide',
  slug: 'widget-guide',
  keyword: 'widgets',
  status: 'generated',
  images_status: 'complete',
  created_at: new Date('2026-08-20T06:00:00Z'),
  published_at: null,
  updated_at: null,
  publications: [] as unknown[],
  auto_publish: { preflight_error: null, attempts: [] as unknown[] },
  ...over,
});

const keyword = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  org_id: 'o1',
  keyword: 'widgets',
  scheduled_date: '2026-08-23',
  article_id: null,
  generation_status: 'pending',
  generation_attempts: 0,
  generation_error: null,
  ...over,
});

const paidOrg = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  plan: 'paid',
  website_url: 'https://example.com',
  presets: { article_preferences: { publishing: { auto_publish: true } } },
  ...over,
});

const integration = (provider: string) => ({ org_id: 'o1', provider });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PUBLISH_QUEUE_URL = 'https://sqs.test/publish';
});

describe('listArticles', () => {
  test('maps articles to rows with attempt and publication summaries', async () => {
    repos.articleListByOrg.mockResolvedValueOnce({
      total: 1,
      articles: [
        article({
          auto_publish: { preflight_error: null, attempts: [attempt()] },
          publications: [
            {
              provider: 'static-site',
              ref: 'sha1',
              slug: 'widget-guide',
              published_at: new Date('2026-08-20T08:00:00Z'),
              updated_at: null,
              remote_url: null,
            },
          ],
        }),
      ],
    });
    const result = await listArticles({ org: 'o1', limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.org_id).toBe('o1');
    expect(result.data.total).toBe(1);
    expect(result.data.articles[0]).toMatchObject({
      id: 'a1',
      status: 'generated',
      images_status: 'complete',
      attempts: [{ provider: 'wordpress', status: 'failed' }],
      published_to: ['static-site'],
    });
    expect(repos.closeDb).toHaveBeenCalled();
  });

  test('fails BAD_TARGET when neither --org nor --user is given', async () => {
    const result = await listArticles({ limit: 50 });
    expect(result).toMatchObject({ ok: false, error: { code: 'BAD_TARGET' } });
  });
});

describe('showArticle', () => {
  test('returns the full detail with ISO dates and the planner keyword', async () => {
    repos.articleFindById.mockResolvedValueOnce(
      article({ auto_publish: { preflight_error: null, attempts: [attempt()] } }),
    );
    repos.keywordFindById.mockResolvedValueOnce(
      keyword({ article_id: 'a1', generation_status: 'generated' }),
    );
    const result = await showArticle('a1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created_at).toBe('2026-08-20T06:00:00.000Z');
    expect(result.data.attempts[0]).toMatchObject({
      provider: 'wordpress',
      status: 'failed',
      last_error: { code: 'plugin_upgrade_required', at: '2026-08-20T07:05:00.000Z' },
    });
    expect(result.data.planner).toMatchObject({
      keyword_id: 'k1',
      generation_status: 'generated',
    });
  });

  test('tolerates a deleted planner keyword (planner: null)', async () => {
    repos.articleFindById.mockResolvedValueOnce(article());
    repos.keywordFindById.mockResolvedValueOnce(null);
    const result = await showArticle('a1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.planner).toBeNull();
  });

  test('fails ARTICLE_NOT_FOUND for an unknown id', async () => {
    repos.articleFindById.mockResolvedValueOnce(null);
    const result = await showArticle('nope');
    expect(result).toMatchObject({ ok: false, error: { code: 'ARTICLE_NOT_FOUND' } });
  });
});

describe('generateNext', () => {
  const pending = (id: string, date: string, over: Record<string, unknown> = {}) =>
    keyword({ id, scheduled_date: date, ...over });

  beforeEach(() => {
    repos.orgFindById.mockResolvedValue(paidOrg());
  });

  test('launches the next N eligible keywords, oldest scheduled_date first', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([
      pending('k1', '2026-08-23', { article_id: 'a0', generation_status: 'generated' }),
      pending('k2', '2026-08-24'),
      pending('k3', '2026-08-25', { generation_status: 'failed', generation_attempts: 3 }),
      pending('k4', '2026-08-26'),
    ]);
    const result = await generateNext({ org: 'o1', count: 2, wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // k1 is generated, k3 is out of attempts — k2 and k4 are the next two.
    expect(result.data.enqueued).toEqual([
      { keyword_id: 'k2', keyword: 'widgets', run_id: 'run_k2' },
      { keyword_id: 'k4', keyword: 'widgets', run_id: 'run_k4' },
    ]);
    expect(launchGeneration).toHaveBeenCalledTimes(2);
    expect(launchGeneration).toHaveBeenCalledWith('o1', 'k2', { wait: false });
    expect(launchGeneration).toHaveBeenCalledWith('o1', 'k4', { wait: false });
  });

  test('retries a failed keyword with attempts left', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([
      pending('k1', '2026-08-20', { generation_status: 'failed', generation_attempts: 1 }),
    ]);
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.enqueued.map((e) => e.keyword_id)).toEqual(['k1']);
  });

  test('a claim-lost (null) launch is omitted from the result', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([pending('k1', '2026-08-20')]);
    launchGeneration.mockResolvedValueOnce(null);
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.enqueued).toEqual([]);
  });

  test('fails NO_KEYWORDS_DUE when nothing is eligible', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([
      pending('k1', '2026-08-20', { article_id: 'a1', generation_status: 'generated' }),
    ]);
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'NO_KEYWORDS_DUE' } });
  });

  test('fails ORG_NOT_PAID before listing keywords, so --wait never burns its timeout', async () => {
    repos.orgFindById.mockResolvedValue(paidOrg({ plan: 'free' }));
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'ORG_NOT_PAID' } });
    expect(repos.keywordListByOrg).not.toHaveBeenCalled();
    expect(launchGeneration).not.toHaveBeenCalled();
  });

  test('fails ORG_NOT_FINALIZED when the org has no presets', async () => {
    repos.orgFindById.mockResolvedValue(paidOrg({ presets: null }));
    const result = await generateNext({ org: 'o1', count: 1, wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'ORG_NOT_FINALIZED' } });
    expect(repos.keywordListByOrg).not.toHaveBeenCalled();
    expect(launchGeneration).not.toHaveBeenCalled();
  });
});

describe('publishArticle', () => {
  beforeEach(() => {
    repos.articleFindById.mockResolvedValue(article());
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([
      integration('wordpress'),
      integration('static-site'),
    ]);
  });

  test('resets/initializes attempts and enqueues one task per connected provider', async () => {
    repos.articleFindById.mockResolvedValue(
      article({
        auto_publish: { preflight_error: null, attempts: [attempt({ status: 'failed' })] },
      }),
    );
    const result = await publishArticle({ articleId: 'a1', wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providers).toEqual([
      { provider: 'wordpress', action: 'enqueued' },
      { provider: 'static-site', action: 'enqueued' },
    ]);
    // failed wordpress attempt is reset; static-site has none and is initialized.
    expect(repos.resetAttempt).toHaveBeenCalledWith('a1', 'wordpress', expect.any(Date));
    expect(repos.initAttempt).toHaveBeenCalledWith('a1', 'static-site', expect.any(Date));
    expect(repos.clearPreflight).toHaveBeenCalledWith('a1');
    const bodies = sqs.send.mock.calls
      .slice(1)
      .map((call) => JSON.parse((call[0] as { input: { MessageBody: string } }).input.MessageBody));
    expect(bodies).toEqual([
      { org_id: 'o1', article_id: 'a1', provider: 'wordpress' },
      { org_id: 'o1', article_id: 'a1', provider: 'static-site' },
    ]);
  });

  test('skips providers already published', async () => {
    repos.articleFindById.mockResolvedValue(
      article({
        publications: [
          {
            provider: 'wordpress',
            ref: '12',
            slug: 'widget-guide',
            published_at: new Date('2026-08-20T08:00:00Z'),
            updated_at: null,
            remote_url: null,
          },
        ],
      }),
    );
    const result = await publishArticle({ articleId: 'a1', wait: false, timeoutMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providers).toEqual([
      { provider: 'wordpress', action: 'skipped_published' },
      { provider: 'static-site', action: 'enqueued' },
    ]);
  });

  test('--provider restricts to one connected provider', async () => {
    const result = await publishArticle({
      articleId: 'a1',
      provider: 'static-site',
      wait: false,
      timeoutMs: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providers).toEqual([{ provider: 'static-site', action: 'enqueued' }]);
  });

  test('fails BAD_ARGS on an unknown provider', async () => {
    const result = await publishArticle({
      articleId: 'a1',
      provider: 'medium',
      wait: false,
      timeoutMs: 0,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'BAD_ARGS' } });
  });

  test.each([
    [
      'IMAGES_INCOMPLETE',
      () => repos.articleFindById.mockResolvedValue(article({ images_status: 'pending' })),
    ],
    [
      'AUTO_PUBLISH_DISABLED',
      () =>
        repos.orgFindById.mockResolvedValue(
          paidOrg({ presets: { article_preferences: { publishing: { auto_publish: false } } } }),
        ),
    ],
    ['ORG_NOT_PAID', () => repos.orgFindById.mockResolvedValue(paidOrg({ plan: 'free' }))],
    ['NOT_CONNECTED', () => repos.integrationsList.mockResolvedValue([])],
  ] as const)('fails fast with %s', async (code, arrange) => {
    arrange();
    const result = await publishArticle({ articleId: 'a1', wait: false, timeoutMs: 0 });
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(repos.initAttempt).not.toHaveBeenCalled();
    // Only the preflight probe — no publish task was enqueued.
    expect(sqs.send).toHaveBeenCalledTimes(1);
  });

  test('fails NOT_CONNECTED when --provider names an unconnected one', async () => {
    repos.integrationsList.mockResolvedValue([integration('static-site')]);
    const result = await publishArticle({
      articleId: 'a1',
      provider: 'wordpress',
      wait: false,
      timeoutMs: 0,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
  });
});

describe('--wait', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('generate-next --wait polls until the article is published', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([keyword()]);
    // Wait-start expectation lookup: org is paid + auto_publish on + wordpress connected.
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([integration('wordpress')]);
    // Poll 1: still generating. Poll 2: article linked and published.
    repos.keywordFindById
      .mockResolvedValueOnce(keyword({ generation_status: 'generating' }))
      .mockResolvedValue(keyword({ article_id: 'a1', generation_status: 'generated' }));
    repos.articleFindById.mockResolvedValue(
      article({
        status: 'published',
        auto_publish: {
          preflight_error: null,
          attempts: [attempt({ status: 'published', last_error: null })],
        },
      }),
    );

    const promise = generateNext({ org: 'o1', count: 1, wait: true, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [{ keyword_id: 'k1', article_id: 'a1', done: true, ok: true }],
    });
  });

  test('generate-next --wait reports failure when generation exhausts attempts', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([keyword()]);
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([]);
    repos.keywordFindById.mockResolvedValue(
      keyword({ generation_status: 'failed', generation_attempts: 3, generation_error: 'boom' }),
    );

    const result = await generateNext({ org: 'o1', count: 1, wait: true, timeoutMs: 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [{ done: true, ok: false, generation_status: 'failed' }],
    });
  });

  test('generate-next --wait times out with the last observed state', async () => {
    repos.keywordListByOrg.mockResolvedValueOnce([keyword()]);
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([]);
    repos.keywordFindById.mockResolvedValue(keyword({ generation_status: 'generating' }));

    const promise = generateNext({ org: 'o1', count: 1, wait: true, timeoutMs: 12_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: true,
      outcomes: [{ done: false, generation_status: 'generating' }],
    });
  });

  test('publish --wait resolves when the enqueued provider publishes', async () => {
    repos.articleFindById
      .mockResolvedValueOnce(article()) // initial load
      .mockResolvedValueOnce(
        article({
          auto_publish: {
            preflight_error: null,
            attempts: [attempt({ status: 'publishing', last_error: null })],
          },
        }),
      ) // poll 1
      .mockResolvedValue(
        article({
          status: 'published',
          publications: [
            {
              provider: 'wordpress',
              ref: '12',
              slug: 'widget-guide',
              published_at: new Date('2026-08-22T09:00:00Z'),
              updated_at: null,
              remote_url: 'https://example.com/widget-guide',
            },
          ],
        }),
      );
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([integration('wordpress')]);

    const promise = publishArticle({ articleId: 'a1', wait: true, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [{ article_id: 'a1', done: true, ok: true }],
    });
  });

  test('publish --wait reports a failed attempt with its error code', async () => {
    repos.articleFindById.mockResolvedValueOnce(article()).mockResolvedValue(
      article({
        auto_publish: { preflight_error: null, attempts: [attempt({ status: 'failed' })] },
      }),
    );
    repos.orgFindById.mockResolvedValue(paidOrg());
    repos.integrationsList.mockResolvedValue([integration('wordpress')]);

    const result = await publishArticle({ articleId: 'a1', wait: true, timeoutMs: 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wait).toMatchObject({
      timed_out: false,
      outcomes: [
        {
          done: true,
          ok: false,
          attempts: [{ provider: 'wordpress', status: 'failed', error: 'plugin_upgrade_required' }],
        },
      ],
    });
  });
});
