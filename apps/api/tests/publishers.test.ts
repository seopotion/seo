import type { Article, Integration } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPublishedTo: vi.fn(async (_orgId: string, _provider: string): Promise<Article[]> => []),
  recordPublication: vi.fn(async () => true),
  claimPublishLease: vi.fn(
    async (_orgId: string, _provider: string, _token: string, _now: Date, _leaseMs: number) => true,
  ),
  releasePublishLease: vi.fn(async (_orgId: string, _provider: string, _token: string) => true),
  capabilities: vi.fn(),
  submit: vi.fn(),
  edit: vi.fn(),
  commitFiles: vi.fn(),
  preparedFiles: [] as Array<Array<{ path: string; content: string | null }>>,
}));

vi.mock('@shared/db', () => ({
  ArticleRepo: {
    listPublishedTo: mocks.listPublishedTo,
    recordPublication: mocks.recordPublication,
  },
  IntegrationRepo: {
    claimPublishLease: mocks.claimPublishLease,
    releasePublishLease: mocks.releasePublishLease,
  },
}));
vi.mock('../src/clients/wordpress', () => ({
  getWordPressCapabilities: mocks.capabilities,
  submitWordPressArticle: mocks.submit,
  editWordPressArticle: mocks.edit,
}));
vi.mock('../src/clients/github', async (original) => ({
  ...(await original<typeof import('../src/clients/github')>()),
  commitFiles: mocks.commitFiles,
}));

import {
  publishStaticSiteArticle,
  publishWordPressArticle,
  updateWordPressArticle,
} from '../src/lib/publishers';
import { PublishingFailure } from '../src/lib/publishing-errors';

const article: Article = {
  id: 'article-1',
  org_id: 'org-1',
  keyword_id: 'keyword-1',
  title: 'Publishing Guide',
  meta_title: 'Publishing Guide',
  slug: 'publishing-guide',
  keyword: 'publishing guide',
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  meta_description: 'A publishing guide.',
  featured_image_url: 'https://cdn.example/cover.webp',
  content: '# Publishing Guide\n\nBody.',
  difficulty: 12,
  search_volume: 100,
  status: 'generated',
  created_at: new Date('2026-08-12T08:00:00.000Z'),
  published_at: null,
  publications: [],
  auto_publish: { preflight_error: null, attempts: [] },
  updated_at: null,
  images: [],
  images_status: 'complete',
  video: null,
};
const staticSite: Extract<Integration, { provider: 'static-site' }> = {
  id: 'integration-1',
  org_id: 'org-1',
  provider: 'static-site',
  host: 'github',
  installation_id: 7,
  repo: 'acme/site',
  branch: 'main',
  content_path: 'seopotion/',
  post_url_base: 'https://acme.com',
  connected_at: new Date(),
  last_error: null,
};
const requestedAt = new Date('2026-08-12T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preparedFiles.length = 0;
  mocks.listPublishedTo.mockResolvedValue([]);
  mocks.recordPublication.mockResolvedValue(true);
  mocks.claimPublishLease.mockResolvedValue(true);
  mocks.releasePublishLease.mockResolvedValue(true);
  mocks.capabilities.mockResolvedValue({
    version: '1.2.0',
    capabilities: ['submit', 'edit', 'idempotent_publish'],
  });
  mocks.submit.mockResolvedValue({
    status: 200,
    body: {
      success: true,
      post_id: 42,
      slug: 'publishing-guide-2',
      permalink: 'https://example.com/publishing-guide-2/',
      post_status: 'publish',
    },
  });
  mocks.commitFiles.mockImplementation(async (options) => {
    const files = options.files
      ? options.files
      : await options.prepare({ headCommitSha: 'base', readFile: async () => null });
    mocks.preparedFiles.push(files);
    return 'abc123';
  });
});

describe('shared WordPress publisher', () => {
  test('requires the idempotency capability and explicitly requests a live post', async () => {
    await expect(
      publishWordPressArticle({
        article,
        websiteUrl: 'https://example.com',
        token: 'token',
        automatic: true,
        at: requestedAt,
      }),
    ).resolves.toMatchObject({
      ref: '42',
      post_id: 42,
      slug: 'publishing-guide-2',
      remote_url: 'https://example.com/publishing-guide-2/',
      published_at: requestedAt,
    });

    expect(mocks.capabilities).toHaveBeenCalledWith('https://example.com');
    expect(mocks.submit).toHaveBeenCalledWith('https://example.com', 'token', article, {
      sourceArticleId: 'article-1',
      status: 'publish',
    });
  });

  test('does not call the unsafe submit endpoint when the plugin is too old', async () => {
    mocks.capabilities.mockResolvedValue({
      version: '1.1.0',
      capabilities: ['submit', 'edit', 'idempotent_publish'],
    });

    const failure = await publishWordPressArticle({
      article,
      websiteUrl: 'https://example.com',
      token: 'token',
      automatic: true,
      at: requestedAt,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PublishingFailure);
    expect(failure).toMatchObject({
      error: { code: 'plugin_upgrade_required', kind: 'permanent' },
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  test('does not record a draft as automatic-publish success', async () => {
    mocks.submit.mockResolvedValue({
      status: 200,
      body: {
        success: true,
        post_id: 42,
        slug: 'publishing-guide',
        permalink: 'https://example.com/publishing-guide/',
        post_status: 'draft',
      },
    });

    await expect(
      publishWordPressArticle({
        article,
        websiteUrl: 'https://example.com',
        token: 'token',
        automatic: true,
        at: requestedAt,
      }),
    ).rejects.toMatchObject({
      error: { code: 'invalid_provider_response', kind: 'transient' },
    });
  });

  test('repeated crash-recovery submits retain one source key and converge to one post', async () => {
    const input = {
      article,
      websiteUrl: 'https://example.com',
      token: 'token',
      automatic: true,
      at: requestedAt,
    } as const;

    const first = await publishWordPressArticle(input);
    const recovered = await publishWordPressArticle(input);

    expect(first.ref).toBe('42');
    expect(recovered.ref).toBe('42');
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls.map((call) => call[3]?.sourceArticleId)).toEqual([
      'article-1',
      'article-1',
    ]);
  });

  test('manual update maps a missing remote post without claiming a plugin upgrade', async () => {
    mocks.edit.mockResolvedValue({ status: 404, body: { error: 'Post not found' } });

    await expect(
      updateWordPressArticle({
        article,
        websiteUrl: 'https://example.com',
        token: 'token',
        postId: 42,
      }),
    ).rejects.toMatchObject({
      httpStatus: 404,
      error: { code: 'wordpress_post_not_found', kind: 'permanent' },
      message: 'The WordPress post no longer exists.',
    });
  });

  test('does not persist an invalid manual permalink', async () => {
    mocks.submit.mockResolvedValue({
      status: 200,
      body: {
        success: true,
        post_id: 42,
        slug: 'publishing-guide',
        permalink: 'not a URL',
        post_status: 'draft',
      },
    });

    await expect(
      publishWordPressArticle({
        article,
        websiteUrl: 'https://example.com',
        token: 'token',
        automatic: false,
      }),
    ).resolves.toMatchObject({ remote_url: null });
  });

  test('does not persist an empty manual-update permalink', async () => {
    mocks.edit.mockResolvedValue({
      status: 200,
      body: {
        success: true,
        post_id: 42,
        slug: 'publishing-guide',
        permalink: '',
        post_status: 'publish',
      },
    });

    await expect(
      updateWordPressArticle({
        article,
        websiteUrl: 'https://example.com',
        token: 'token',
        postId: 42,
      }),
    ).resolves.toMatchObject({ remote_url: null });
  });
});

describe('shared static-site publisher', () => {
  test('uses one stable requested timestamp for deterministic retry input', async () => {
    const input = { article, integration: staticSite, at: requestedAt };
    const first = await publishStaticSiteArticle(input);
    const recovered = await publishStaticSiteArticle(input);

    expect(first).toMatchObject({
      ref: 'abc123',
      remote_url: 'https://github.com/acme/site/commit/abc123',
      published_at: requestedAt,
    });
    expect(recovered.ref).toBe('abc123');
    expect(mocks.commitFiles).toHaveBeenCalledTimes(2);
    expect(mocks.preparedFiles[0]).toEqual(mocks.preparedFiles[1]);
  });

  test('rejects a slug already used by another static-site article', async () => {
    mocks.listPublishedTo.mockResolvedValue([
      {
        ...article,
        id: 'article-2',
        publications: [
          {
            provider: 'static-site',
            ref: 'old',
            slug: article.slug,
            remote_url: null,
            published_at: requestedAt,
            updated_at: null,
          },
        ],
      },
    ]);

    await expect(
      publishStaticSiteArticle({ article, integration: staticSite, at: requestedAt }),
    ).rejects.toMatchObject({ error: { code: 'slug_conflict', kind: 'permanent' } });
    expect(mocks.commitFiles).toHaveBeenCalledOnce();
    expect(mocks.recordPublication).not.toHaveBeenCalled();
    expect(mocks.releasePublishLease).toHaveBeenCalledOnce();
  });

  test('returns a recorded success when lease release fails', async () => {
    mocks.releasePublishLease.mockRejectedValueOnce(new Error('mongo unavailable'));

    await expect(
      publishStaticSiteArticle({ article, integration: staticSite, at: requestedAt }),
    ).resolves.toMatchObject({ ref: 'abc123', published_at: requestedAt });
    expect(mocks.releasePublishLease).toHaveBeenCalledOnce();
  });

  test('preserves the primary publishing failure when lease release also fails', async () => {
    mocks.listPublishedTo.mockResolvedValue([
      {
        ...article,
        id: 'article-2',
        publications: [
          {
            provider: 'static-site',
            ref: 'old',
            slug: article.slug,
            remote_url: null,
            published_at: requestedAt,
            updated_at: null,
          },
        ],
      },
    ]);
    mocks.releasePublishLease.mockRejectedValueOnce(new Error('mongo unavailable'));

    const failure = await publishStaticSiteArticle({
      article,
      integration: staticSite,
      at: requestedAt,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PublishingFailure);
    expect(failure).toMatchObject({ error: { code: 'slug_conflict', kind: 'permanent' } });
    expect(mocks.releasePublishLease).toHaveBeenCalledOnce();
  });

  test('releases exactly once with the token that claimed the lease', async () => {
    await publishStaticSiteArticle({ article, integration: staticSite, at: requestedAt });

    const claimedToken = mocks.claimPublishLease.mock.calls[0]?.[2];
    expect(claimedToken).toEqual(expect.any(String));
    expect(mocks.releasePublishLease).toHaveBeenCalledTimes(1);
    expect(mocks.releasePublishLease).toHaveBeenCalledWith(
      article.org_id,
      'static-site',
      claimedToken,
    );
  });
});
