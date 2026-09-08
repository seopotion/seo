import type { Article, Integration } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  ArticleRepo: { findById: vi.fn() },
  IntegrationRepo: { findByOrgAndProvider: vi.fn(), setError: vi.fn() },
  OrgRepo: { findById: vi.fn() },
  AdminActionRepo: { insert: vi.fn() },
  CandidateRepo: {},
  GscConnectionRepo: {},
  KeywordRepo: {},
  PromoCodeRepo: {},
  PromoRedemptionRepo: {},
  SubscriptionRepo: {},
  UserRepo: {},
  addCandidates: vi.fn(),
  isDuplicateKeyError: vi.fn(),
  scheduleCandidate: vi.fn(),
}));
vi.mock('@shared/db', () => repos);

const publishers = vi.hoisted(() => ({ publishStaticSiteArticle: vi.fn() }));
vi.mock('../src/lib/publishers', () => publishers);

vi.mock('@shared/articles', () => ({ launchImageRepair: vi.fn() }));

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';
import { PublishingFailure } from '../src/lib/publishing-errors';

const client = testClient<AdminAppType>(adminApp);
const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

const org = {
  id: 'a'.repeat(24),
  user_id: 'u'.repeat(24),
  website_url: 'https://site.example',
  setup_status: 'setup_complete' as const,
  plan: 'expert' as const,
  strategy_status: 'completed' as const,
  created_at: new Date('2026-07-01T00:00:00.000Z'),
};

const article: Article = {
  id: 'b'.repeat(24),
  org_id: org.id,
  keyword_id: 'k'.repeat(24),
  keyword: 'crm guide',
  title: 'CRM Guide',
  meta_title: 'CRM Guide',
  slug: 'crm-guide',
  meta_description: 'A CRM guide.',
  featured_image_url: 'https://cdn.example/cover.webp',
  content: '# CRM Guide',
  difficulty: 20,
  search_volume: 500,
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  status: 'generated' as const,
  created_at: new Date('2026-07-02T00:00:00.000Z'),
  published_at: null,
  publications: [],
  auto_publish: { preflight_error: null, attempts: [] },
  updated_at: null,
  images: [],
  images_status: 'complete' as const,
  video: null,
  readability: null,
};

const wordpress: Extract<Integration, { provider: 'wordpress' }> = {
  id: 'w'.repeat(24),
  org_id: org.id,
  provider: 'wordpress' as const,
  site_url: 'https://site.example',
  token_enc: 'encrypted-wordpress-token',
  connected_at: new Date('2026-07-03T00:00:00.000Z'),
  last_error: {
    code: 'wordpress_auth_failed',
    at: new Date('2026-07-04T00:00:00.000Z'),
  },
};

const staticSite: Extract<Integration, { provider: 'static-site' }> = {
  id: 's'.repeat(24),
  org_id: org.id,
  provider: 'static-site' as const,
  host: 'github' as const,
  installation_id: 123456,
  repo: 'owner/repository',
  branch: 'main',
  content_path: 'seopotion/',
  post_url_base: 'https://site.example/articles',
  connected_at: new Date('2026-07-05T00:00:00.000Z'),
  last_error: null,
};

const published = {
  ref: 'abc123',
  slug: article.slug,
  remote_url: 'https://github.com/owner/repository/commit/abc123',
  published_at: new Date('2026-07-06T00:00:00.000Z'),
  path: 'seopotion/articles/crm-guide.md',
};

const targetRequest = async (articleId = article.id) =>
  client.admin.v0.articles[':article_id']['publishing-targets'].$get(
    { param: { article_id: articleId } },
    await authed(),
  );

const publishRequest = async (articleId = article.id) =>
  client.admin.v0.articles[':article_id']['static-site'].$post(
    { param: { article_id: articleId } },
    await authed(),
  );

beforeEach(() => {
  vi.clearAllMocks();
  repos.AdminActionRepo.insert.mockResolvedValue({});
  repos.IntegrationRepo.setError.mockResolvedValue(undefined);
});

describe('admin article publishing authentication and lookup', () => {
  test.each([
    ['missing', undefined],
    ['invalid', 'Bearer invalid'],
  ])('%s admin authentication is rejected', async (_name, authorization) => {
    const headers = authorization ? { Authorization: authorization } : undefined;
    const res = await adminApp.request(`/admin/v0/articles/${article.id}/publishing-targets`, {
      headers,
    });
    expect(res.status).toBe(401);
    expect(repos.ArticleRepo.findById).not.toHaveBeenCalled();
  });

  test('missing article returns not_found', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(null);
    const res = await targetRequest();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(repos.OrgRepo.findById).not.toHaveBeenCalled();
  });

  test('missing organization returns not_found', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    repos.OrgRepo.findById.mockResolvedValueOnce(null);
    const res = await publishRequest();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(repos.IntegrationRepo.findByOrgAndProvider).not.toHaveBeenCalled();
  });
});

describe('GET /admin/v0/articles/{article_id}/publishing-targets', () => {
  const arrange = (
    organization: typeof org & {
      wordpress_token?: string;
      wordpress_connected_at?: Date;
      onboarding?: { referral_source: string; integrations: ('wordpress-com' | 'framer')[] };
    },
    wordpressIntegration: typeof wordpress | null,
    staticIntegration: typeof staticSite | null,
  ) => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    repos.OrgRepo.findById.mockResolvedValueOnce(organization);
    repos.IntegrationRepo.findByOrgAndProvider
      .mockResolvedValueOnce(wordpressIntegration)
      .mockResolvedValueOnce(staticIntegration);
  };

  test('returns no destinations when the organization has no connections', async () => {
    arrange(
      {
        ...org,
        onboarding: { referral_source: 'search', integrations: ['wordpress-com', 'framer'] },
      },
      null,
      null,
    );
    const res = await targetRequest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ destinations: [] });
  });

  test('returns only the usable legacy WordPress connection with its safe error', async () => {
    arrange(
      {
        ...org,
        wordpress_token: 'legacy-secret',
        wordpress_connected_at: new Date('2026-07-03T00:00:00.000Z'),
      },
      wordpress,
      null,
    );
    const res = await targetRequest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      destinations: [
        {
          provider: 'wordpress',
          target: 'https://site.example',
          connected_at: '2026-07-03T00:00:00.000Z',
          last_error: {
            code: 'wordpress_auth_failed',
            at: '2026-07-04T00:00:00.000Z',
          },
        },
      ],
    });
  });

  test('returns only a static-site Integration target', async () => {
    arrange(org, null, staticSite);
    const res = await targetRequest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      destinations: [
        {
          provider: 'static-site',
          target: 'owner/repository@main',
          connected_at: '2026-07-05T00:00:00.000Z',
          last_error: null,
        },
      ],
    });
  });

  test('returns WordPress before static site and no credentials or installation id', async () => {
    arrange(
      {
        ...org,
        wordpress_token: 'legacy-secret',
        wordpress_connected_at: new Date('2026-07-03T00:00:00.000Z'),
      },
      wordpress,
      staticSite,
    );
    const res = await targetRequest();
    if (res.status !== 200) throw new Error('expected 200');
    const body = await res.json();
    expect(body.destinations.map((destination) => destination.provider)).toEqual([
      'wordpress',
      'static-site',
    ]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('legacy-secret');
    expect(serialized).not.toContain('encrypted-wordpress-token');
    expect(serialized).not.toContain('installation_id');
    expect(serialized).not.toContain('123456');
  });
});

describe('POST /admin/v0/articles/{article_id}/static-site', () => {
  const arrange = (
    value: Article = article,
    integration: typeof staticSite | null = staticSite,
  ) => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(value);
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.IntegrationRepo.findByOrgAndProvider.mockResolvedValueOnce(integration);
  };

  test('refuses a missing connection without publishing or auditing', async () => {
    arrange(article, null);
    const res = await publishRequest();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'static_site_not_connected' });
    expect(publishers.publishStaticSiteArticle).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('refuses incomplete images without publishing or auditing', async () => {
    arrange({ ...article, images_status: 'pending' as const });
    const res = await publishRequest();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'images_not_complete' });
    expect(publishers.publishStaticSiteArticle).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('publishes a manual article with image metadata unchanged and audits success', async () => {
    const manual = {
      ...article,
      keyword_id: null,
      images: [
        {
          role: 'cover' as const,
          section_heading: null,
          prompt: '',
          alt: 'CRM dashboard',
          url: 'https://cdn.example/manual.webp',
          model: null,
          seed: null,
          generated_at: new Date('2026-07-05T00:00:00.000Z'),
          width: 1200,
          height: 630,
        },
      ],
    };
    arrange(manual);
    publishers.publishStaticSiteArticle.mockResolvedValueOnce(published);
    const res = await publishRequest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      commit_sha: published.ref,
      commit_url: published.remote_url,
      path: published.path,
    });
    expect(publishers.publishStaticSiteArticle).toHaveBeenCalledWith({
      article: manual,
      integration: staticSite,
    });
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith({
      actor: 'op@example.com',
      action: 'article.static_site_publish',
      org_id: org.id,
      entity: { type: 'article', id: article.id },
      payload: { ref: published.ref, slug: published.slug, path: published.path },
      before: null,
    });
  });

  test('updates a generated article and audits the prior static-site publication', async () => {
    const previous = {
      provider: 'static-site' as const,
      ref: 'old-sha',
      slug: 'old-slug',
      published_at: new Date('2026-07-01T00:00:00.000Z'),
      updated_at: null,
      remote_url: 'https://github.com/owner/repository/commit/old-sha',
    };
    const generated = { ...article, publications: [previous] };
    arrange(generated);
    publishers.publishStaticSiteArticle.mockResolvedValueOnce(published);
    const res = await publishRequest();
    expect(res.status).toBe(200);
    expect(publishers.publishStaticSiteArticle).toHaveBeenCalledWith({
      article: generated,
      integration: staticSite,
    });
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'article.static_site_update',
        before: previous,
      }),
    );
  });

  test.each([
    ['static_publish_in_progress', 409],
    ['ref_conflict', 409],
    ['slug_conflict', 409],
    ['installation_not_found', 422],
    ['installation_suspended', 422],
    ['missing_write_permission', 422],
    ['repo_not_found', 422],
    ['commit_rejected', 422],
    ['record_failed', 500],
    ['github_request_failed', 502],
    ['invalid_provider_response', 502],
  ] as const)('maps %s to %i without auditing', async (code, status) => {
    arrange();
    publishers.publishStaticSiteArticle.mockRejectedValueOnce(
      new PublishingFailure(
        { code, kind: status === 422 ? 'permanent' : 'transient', message: code, at: new Date() },
        status,
      ),
    );
    const res = await publishRequest();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
    if (status === 422) {
      expect(repos.IntegrationRepo.setError).toHaveBeenCalledWith(org.id, 'static-site', code);
    } else {
      expect(repos.IntegrationRepo.setError).not.toHaveBeenCalled();
    }
  });

  test('maps unexpected provider failure to github_request_failed without auditing', async () => {
    arrange();
    publishers.publishStaticSiteArticle.mockRejectedValueOnce(new Error('network down'));
    const res = await publishRequest();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'github_request_failed' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('clears an existing integration error after a successful publish', async () => {
    arrange(article, {
      ...staticSite,
      last_error: { code: 'repo_not_found', at: new Date('2026-07-05T00:00:00.000Z') },
    });
    publishers.publishStaticSiteArticle.mockResolvedValueOnce(published);
    const res = await publishRequest();
    expect(res.status).toBe(200);
    expect(repos.IntegrationRepo.setError).toHaveBeenCalledWith(org.id, 'static-site', null);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledTimes(1);
  });
});
