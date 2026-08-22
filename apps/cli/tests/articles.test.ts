import { beforeEach, describe, expect, test, vi } from 'vitest';

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

// The real index pulls the whole generation pipeline into the graph.
vi.mock('@shared/generation', () => ({ MAX_GENERATION_ATTEMPTS: 3 }));

import { listArticles, showArticle } from '../src/lib/articles';

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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GENERATION_QUEUE_URL = 'https://sqs.test/generation';
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
