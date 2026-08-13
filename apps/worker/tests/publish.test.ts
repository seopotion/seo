import type { PublishingError } from '@shared/schemas';
import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findArticle: vi.fn(),
  findOrg: vi.fn(),
  findIntegration: vi.fn(),
  claimAttempt: vi.fn(),
  completeAttempt: vi.fn(async () => true),
  retryAttempt: vi.fn(
    async (_id: string, _provider: string, _lease: Date, _error: PublishingError) => true,
  ),
  failAttempt: vi.fn(async () => true),
  cancelAttempt: vi.fn(async () => true),
  recordPublication: vi.fn(async () => true),
  setWordPressPostId: vi.fn(async () => true),
  setIntegrationError: vi.fn(async () => {}),
  publishWordPress: vi.fn(),
  publishStaticSite: vi.fn(),
  decryptSecret: vi.fn(() => 'decrypted-token'),
}));

vi.mock('@shared/db', () => ({
  ArticleRepo: {
    findById: mocks.findArticle,
    claimAutoPublishAttempt: mocks.claimAttempt,
    completeAutoPublishAttempt: mocks.completeAttempt,
    recordAutoPublishRetry: mocks.retryAttempt,
    failAutoPublishAttempt: mocks.failAttempt,
    cancelAutoPublishAttempt: mocks.cancelAttempt,
    recordPublication: mocks.recordPublication,
    setWordPressPostId: mocks.setWordPressPostId,
  },
  OrgRepo: { findByIdWithoutSecrets: mocks.findOrg },
  IntegrationRepo: {
    findByOrgAndProvider: mocks.findIntegration,
    setError: mocks.setIntegrationError,
  },
}));

vi.mock('../../api/src/lib/publishers', () => ({
  publishWordPressArticle: mocks.publishWordPress,
  publishStaticSiteArticle: mocks.publishStaticSite,
}));
vi.mock('../../api/src/lib/crypto', () => ({ decryptSecret: mocks.decryptSecret }));
vi.mock('../../api/src/lib/secrets', () => ({
  getGscTokenKey: vi.fn(async () => Buffer.alloc(32, 1)),
}));

import { publishingFailure } from '../../api/src/lib/publishing-errors';
import { logger } from '../src/logger';
import { handler } from '../src/publish';

function event(
  provider: 'wordpress' | 'static-site',
  body: Record<string, unknown> = {},
): SQSEvent {
  return {
    Records: [
      {
        messageId: 'm1',
        receiptHandle: 'rh',
        body: JSON.stringify({ org_id: 'o1', article_id: 'a1', provider, ...body }),
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

const requestedAt = new Date('2026-08-12T10:00:00.000Z');
const leaseExpiresAt = new Date('2026-08-12T10:05:00.000Z');
const article = {
  id: 'a1',
  org_id: 'o1',
  keyword_id: 'k1',
  title: 'Article',
  meta_title: 'Article',
  slug: 'article',
  keyword: 'article',
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  meta_description: 'Description',
  featured_image_url: 'https://cdn.example/cover.webp',
  content: '# Article',
  difficulty: 1,
  search_volume: 2,
  status: 'generated',
  created_at: new Date('2026-08-12T09:00:00.000Z'),
  published_at: null,
  publications: [],
  auto_publish: {
    preflight_error: null,
    attempts: [
      {
        provider: 'wordpress',
        status: 'queued',
        attempt_count: 0,
        requested_at: requestedAt,
        last_attempt_at: null,
        lease_expires_at: null,
        last_error: null,
      },
    ],
  },
  updated_at: null,
  images: [],
  images_status: 'complete',
  video: null,
};
const org = {
  id: 'o1',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'complete',
  plan: 'paid',
  strategy_status: 'complete',
  created_at: new Date(),
  presets: {
    business: { name: 'Acme', language: 'English', country: 'US', description: 'Widgets' },
    audience: { target: ['makers'], competitors: [] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: 'concise',
        internal_links_count: 0,
        table_of_contents: true,
        llm_instructions: '',
      },
      engagement: { image_style: 'flat', youtube_videos: false },
      publishing: { auto_publish: true },
    },
  },
};
const wordpress = {
  id: 'iw',
  org_id: 'o1',
  provider: 'wordpress',
  site_url: 'https://example.com',
  token_enc: 'encrypted-token',
  connected_at: new Date(),
  last_error: null,
};
const staticSite = {
  id: 'is',
  org_id: 'o1',
  provider: 'static-site',
  host: 'github',
  installation_id: 7,
  repo: 'acme/site',
  branch: 'main',
  content_path: 'seopotion/',
  connected_at: new Date(),
  last_error: null,
};
const claim = {
  provider: 'wordpress',
  status: 'publishing',
  attempt_count: 1,
  requested_at: requestedAt,
  last_attempt_at: requestedAt,
  lease_expires_at: leaseExpiresAt,
  last_error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findArticle.mockResolvedValue(article);
  mocks.findOrg.mockResolvedValue(org);
  mocks.findIntegration.mockResolvedValue(wordpress);
  mocks.claimAttempt.mockResolvedValue(claim);
  mocks.recordPublication.mockResolvedValue(true);
  mocks.publishWordPress.mockResolvedValue({
    ref: '42',
    post_id: 42,
    slug: 'article-final',
    remote_url: 'https://example.com/article-final/',
    published_at: requestedAt,
    response: { post_id: 42 },
  });
  mocks.publishStaticSite.mockResolvedValue({
    ref: 'abc123',
    slug: 'article',
    remote_url: 'https://github.com/acme/site/commit/abc123',
    published_at: requestedAt,
    path: 'seopotion/articles/article.md',
  });
});

describe('automatic publish worker', () => {
  test('rechecks the setting and cancels without claiming or calling a provider', async () => {
    mocks.findOrg.mockResolvedValue({
      ...org,
      presets: {
        ...org.presets,
        article_preferences: {
          ...org.presets.article_preferences,
          publishing: { auto_publish: false },
        },
      },
    });

    await handler(event('wordpress'), {} as never, () => {});

    expect(mocks.cancelAttempt).toHaveBeenCalledOnce();
    expect(mocks.claimAttempt).not.toHaveBeenCalled();
    expect(mocks.publishWordPress).not.toHaveBeenCalled();
    expect(mocks.decryptSecret).not.toHaveBeenCalled();
  });

  test.each([
    ['images', { article: { ...article, images_status: 'pending' }, code: 'images_incomplete' }],
    ['entitlement', { org: { ...org, plan: 'free' }, code: 'subscription_required' }],
    ['integration', { integration: null, code: 'not_connected' }],
  ])('rejects a missing %s prerequisite without a provider call', async (_name, setup) => {
    if ('article' in setup) mocks.findArticle.mockResolvedValue(setup.article);
    if ('org' in setup) mocks.findOrg.mockResolvedValue(setup.org);
    if ('integration' in setup) mocks.findIntegration.mockResolvedValue(setup.integration);

    await handler(event('wordpress'), {} as never, () => {});

    expect(mocks.failAttempt).toHaveBeenCalledWith(
      'a1',
      'wordpress',
      expect.objectContaining({ code: setup.code, kind: 'permanent' }),
    );
    expect(mocks.publishWordPress).not.toHaveBeenCalled();
  });

  test('reconciles an existing publication without a remote call', async () => {
    mocks.findArticle.mockResolvedValue({
      ...article,
      publications: [
        {
          provider: 'wordpress',
          ref: '42',
          slug: 'article-final',
          remote_url: 'https://example.com/article-final/',
          published_at: requestedAt,
          updated_at: null,
        },
      ],
    });

    await handler(event('wordpress'), {} as never, () => {});

    expect(mocks.completeAttempt).toHaveBeenCalledWith('a1', 'wordpress');
    expect(mocks.setWordPressPostId).toHaveBeenCalledWith('a1', 42);
    expect(mocks.publishWordPress).not.toHaveBeenCalled();
  });

  test('an active duplicate claim makes no remote call', async () => {
    mocks.claimAttempt.mockResolvedValue(null);

    await handler(event('wordpress'), {} as never, () => {});

    expect(mocks.publishWordPress).not.toHaveBeenCalled();
    expect(mocks.recordPublication).not.toHaveBeenCalled();
  });

  test('publishes WordPress live using decrypted integration credentials', async () => {
    await handler(event('wordpress'), {} as never, () => {});

    expect(mocks.decryptSecret).toHaveBeenCalledWith('encrypted-token', expect.any(Buffer));
    expect(mocks.publishWordPress).toHaveBeenCalledWith(
      expect.objectContaining({
        article,
        websiteUrl: 'https://example.com',
        token: 'decrypted-token',
        automatic: true,
        at: requestedAt,
      }),
    );
    expect(mocks.recordPublication).toHaveBeenCalledWith(
      'a1',
      {
        provider: 'wordpress',
        ref: '42',
        slug: 'article-final',
        remote_url: 'https://example.com/article-final/',
      },
      { publishedAt: requestedAt, updatedAt: null },
    );
    expect(mocks.completeAttempt).toHaveBeenCalledWith('a1', 'wordpress');
    expect(mocks.setIntegrationError).toHaveBeenCalledWith('o1', 'wordpress', null);
  });

  test('publishes a static site independently', async () => {
    mocks.findIntegration.mockResolvedValue(staticSite);
    mocks.claimAttempt.mockResolvedValue({ ...claim, provider: 'static-site' });

    await handler(event('static-site'), {} as never, () => {});

    expect(mocks.publishStaticSite).toHaveBeenCalledWith({
      article,
      integration: staticSite,
      at: requestedAt,
    });
    expect(mocks.recordPublication).not.toHaveBeenCalled();
    expect(mocks.completeAttempt).toHaveBeenCalledWith('a1', 'static-site');
    expect(mocks.decryptSecret).not.toHaveBeenCalled();
  });

  test('a permanent provider failure is terminal and acknowledged', async () => {
    mocks.publishWordPress.mockRejectedValue(
      publishingFailure(
        'plugin_upgrade_required',
        'permanent',
        'The WordPress plugin must be upgraded.',
        422,
      ),
    );

    await expect(handler(event('wordpress'), {} as never, () => {})).resolves.toBeUndefined();

    expect(mocks.failAttempt).toHaveBeenCalledWith(
      'a1',
      'wordpress',
      expect.objectContaining({ code: 'plugin_upgrade_required', kind: 'permanent' }),
      leaseExpiresAt,
    );
    expect(mocks.setIntegrationError).toHaveBeenCalledWith(
      'o1',
      'wordpress',
      'plugin_upgrade_required',
    );
    expect(mocks.retryAttempt).not.toHaveBeenCalled();
  });

  test('a transient failure records retry state and rethrows for SQS', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mocks.publishWordPress.mockRejectedValue(new Error('network token=top-secret'));

    await expect(handler(event('wordpress'), {} as never, () => {})).rejects.toThrow();

    expect(mocks.retryAttempt).toHaveBeenCalledWith(
      'a1',
      'wordpress',
      leaseExpiresAt,
      expect.objectContaining({ code: 'network_error', kind: 'transient' }),
    );
    const stored = mocks.retryAttempt.mock.calls[0]![3];
    expect(stored.message).not.toContain('top-secret');
    expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain('top-secret');
    warn.mockRestore();
    error.mockRestore();
  });

  test('the final transient attempt records terminal failure before rethrowing', async () => {
    mocks.claimAttempt.mockResolvedValue({ ...claim, attempt_count: 3 });
    mocks.publishWordPress.mockRejectedValue(new Error('timeout'));

    await expect(handler(event('wordpress'), {} as never, () => {})).rejects.toThrow();

    expect(mocks.failAttempt).toHaveBeenCalledWith(
      'a1',
      'wordpress',
      expect.objectContaining({ code: 'network_error', kind: 'transient' }),
      leaseExpiresAt,
    );
    expect(mocks.retryAttempt).not.toHaveBeenCalled();
  });

  test('one provider failure does not prevent the other task from succeeding', async () => {
    mocks.publishWordPress.mockRejectedValue(
      publishingFailure('wordpress_auth_failed', 'permanent', 'Reconnect WordPress.', 403),
    );
    await handler(event('wordpress'), {} as never, () => {});

    mocks.findIntegration.mockResolvedValue(staticSite);
    mocks.claimAttempt.mockResolvedValue({ ...claim, provider: 'static-site' });
    await handler(event('static-site'), {} as never, () => {});

    expect(mocks.failAttempt).toHaveBeenCalledWith(
      'a1',
      'wordpress',
      expect.objectContaining({ code: 'wordpress_auth_failed' }),
      leaseExpiresAt,
    );
    expect(mocks.publishStaticSite).toHaveBeenCalledOnce();
    expect(mocks.completeAttempt).toHaveBeenCalledWith('a1', 'static-site');
  });
});
