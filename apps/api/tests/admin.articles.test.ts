import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: { findById: vi.fn() },
  ArticleRepo: {
    findById: vi.fn(),
    listByOrg: vi.fn(),
    updateContent: vi.fn(),
    setWordPressPostId: vi.fn(),
    recordPublication: vi.fn(),
  },
  AdminActionRepo: { insert: vi.fn() },
}));
vi.mock('@shared/db', () => repos);

const wp = vi.hoisted(() => ({
  submitWordPressArticle: vi.fn(),
  editWordPressArticle: vi.fn(),
}));
vi.mock('../src/clients/wordpress', () => wp);

const { enqueueImageTask } = vi.hoisted(() => ({ enqueueImageTask: vi.fn() }));
vi.mock('../src/clients/sqs', () => ({
  enqueueImageTask,
  enqueueGenerateTask: vi.fn(),
  enqueueScanTask: vi.fn(),
  enqueueStrategyTask: vi.fn(),
}));

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);

const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

const org = {
  id: 'a'.repeat(24),
  user_id: 'u'.repeat(24),
  website_url: 'https://example.com',
  setup_status: 'setup_complete' as const,
  plan: 'expert' as const,
  strategy_status: 'completed' as const,
  wordpress_token: 'wp-secret-token',
  wordpress_connected_at: new Date('2026-07-01T00:00:00.000Z'),
  created_at: new Date('2026-06-01T00:00:00.000Z'),
};

const article = {
  id: 'b'.repeat(24),
  org_id: org.id,
  keyword_id: 'k'.repeat(24),
  title: 'CRM Guide',
  meta_title: 'CRM Guide — 2026',
  slug: 'crm-guide',
  keyword: 'crm guide',
  meta_description: 'd'.repeat(130),
  featured_image_url: 'https://cdn.example.com/cover.png',
  content: '# CRM Guide\n\nBody.',
  difficulty: 40,
  search_volume: 900,
  status: 'generated' as const,
  created_at: new Date('2026-07-10T00:00:00.000Z'),
  published_at: null,
  updated_at: null,
  publications: [],
  images: [],
  images_status: 'complete' as const,
  video: null,
};

const editBody = {
  title: article.title,
  slug: article.slug,
  meta_title: article.meta_title,
  meta_description: article.meta_description,
  content: article.content,
};

beforeEach(() => {
  vi.clearAllMocks();
  repos.AdminActionRepo.insert.mockResolvedValue({});
});

describe('GET /admin/v0/orgs/{org_id}/articles', () => {
  test('rows include images_status and wordpress_post_id', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.ArticleRepo.listByOrg.mockResolvedValueOnce({
      articles: [{ ...article, wordpress_post_id: 77 }, article],
      total: 2,
    });

    const res = await client.admin.v0.orgs[':org_id'].articles.$get(
      { param: { org_id: org.id }, query: {} },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json.articles[0]).toMatchObject({ images_status: 'complete', wordpress_post_id: 77 });
    expect(json.articles[1]?.wordpress_post_id).toBeNull();
    expect(repos.ArticleRepo.listByOrg).toHaveBeenCalledWith(org.id, {
      status: undefined,
      limit: 20,
      offset: 0,
    });
  });
});

describe('GET /admin/v0/articles/{article_id}', () => {
  test('returns the customer detail field set', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    const res = await client.admin.v0.articles[':article_id'].$get(
      { param: { article_id: article.id } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json).toMatchObject({ title: 'CRM Guide', images_status: 'complete', video: null });
  });

  test('unknown article -> 404', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(null);
    const res = await client.admin.v0.articles[':article_id'].$get(
      { param: { article_id: 'f'.repeat(24) } },
      await authed(),
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/v0/articles/{article_id}', () => {
  const patch = async (article_id: string, body = editBody) =>
    client.admin.v0.articles[':article_id'].$patch(
      { param: { article_id }, json: body },
      await authed(),
    );

  test('images pending -> 409 images_in_progress, no audit', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce({
      ...article,
      images_status: 'pending' as const,
    });
    const res = await patch(article.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'images_in_progress' });
    expect(repos.ArticleRepo.updateContent).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('customer validation rules apply (oversized meta_title) -> 400 with fields', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    const res = await patch(article.id, { ...editBody, meta_title: 'x'.repeat(61) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(json.error).toBe('validation_failed');
    expect(json.fields.meta_title).toContain('60');
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('saves and audits with before = the editable fields only', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    const body = { ...editBody, title: 'CRM Guide v2' };
    repos.ArticleRepo.updateContent.mockResolvedValueOnce({
      ...article,
      ...body,
      updated_at: new Date('2026-07-27T10:00:00.000Z'),
    });

    const res = await patch(article.id, body);
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).title).toBe('CRM Guide v2');
    expect(repos.ArticleRepo.updateContent).toHaveBeenCalledWith(article.id, body);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledTimes(1);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'article.update_content',
        before: {
          title: article.title,
          slug: article.slug,
          meta_title: article.meta_title,
          meta_description: article.meta_description,
          content: article.content,
        },
      }),
    );
  });
});

describe('POST /admin/v0/articles/{article_id}/wordpress (publish)', () => {
  const publish = async (article_id: string) =>
    client.admin.v0.articles[':article_id'].wordpress.$post(
      { param: { article_id } },
      await authed(),
    );

  test.each([
    [
      'no WordPress connection',
      article,
      { ...org, wordpress_token: undefined },
      'wordpress_not_connected',
    ],
    ['already published', { ...article, wordpress_post_id: 77 }, org, 'already_published'],
    [
      'images not complete',
      { ...article, images_status: 'failed' as const },
      org,
      'images_not_complete',
    ],
  ])('%s -> 409, no plugin call, no audit', async (_name, art, o, code) => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(art);
    repos.OrgRepo.findById.mockResolvedValueOnce(o);

    const res = await publish(article.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: code });
    expect(wp.submitWordPressArticle).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('success stores the post id, audits, and passes the plugin body through', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    wp.submitWordPressArticle.mockResolvedValueOnce({
      status: 200,
      body: { success: true, post_id: 42 },
    });
    repos.ArticleRepo.setWordPressPostId.mockResolvedValueOnce(true);

    const res = await publish(article.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, post_id: 42 });
    expect(wp.submitWordPressArticle).toHaveBeenCalledWith(
      org.website_url,
      org.wordpress_token,
      article,
    );
    expect(repos.ArticleRepo.setWordPressPostId).toHaveBeenCalledWith(article.id, 42);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'article.wordpress_publish' }),
    );
  });

  test('plugin error status passes through, no audit', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    wp.submitWordPressArticle.mockResolvedValueOnce({
      status: 403,
      body: { error: 'bad secret' },
    });

    const res = await publish(article.id);
    expect(res.status).toBe(403);
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('network failure -> 502', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    wp.submitWordPressArticle.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await publish(article.id);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'wordpress_request_failed' });
  });
});

describe('PUT /admin/v0/articles/{article_id}/wordpress (update)', () => {
  test('requires a stored post id -> 409 not_published', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    repos.OrgRepo.findById.mockResolvedValueOnce(org);

    const res = await client.admin.v0.articles[':article_id'].wordpress.$put(
      { param: { article_id: article.id } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_published' });
  });

  test('updates the published post and audits', async () => {
    const published = { ...article, wordpress_post_id: 42 };
    repos.ArticleRepo.findById.mockResolvedValueOnce(published);
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    wp.editWordPressArticle.mockResolvedValueOnce({
      status: 200,
      body: { success: true, post_id: 42, warnings: ['slug unchanged'] },
    });

    const res = await client.admin.v0.articles[':article_id'].wordpress.$put(
      { param: { article_id: article.id } },
      await authed(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, post_id: 42, warnings: ['slug unchanged'] });
    expect(wp.editWordPressArticle).toHaveBeenCalledWith(
      org.website_url,
      org.wordpress_token,
      42,
      published,
    );
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'article.wordpress_update' }),
    );
  });

  test('returns an accurate 404 when the remote post was deleted', async () => {
    const published = { ...article, wordpress_post_id: 42 };
    repos.ArticleRepo.findById.mockResolvedValueOnce(published);
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    wp.editWordPressArticle.mockResolvedValueOnce({
      status: 404,
      body: { error: 'Post not found' },
    });

    const res = await client.admin.v0.articles[':article_id'].wordpress.$put(
      { param: { article_id: article.id } },
      await authed(),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'The WordPress post no longer exists.' });
    expect(repos.ArticleRepo.recordPublication).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});

describe('POST /admin/v0/articles/{article_id}/images (replay)', () => {
  test('enqueues the image task and audits with the prior status', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce({
      ...article,
      images_status: 'failed' as const,
    });

    const res = await client.admin.v0.articles[':article_id'].images.$post(
      { param: { article_id: article.id } },
      await authed(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: true });
    expect(enqueueImageTask).toHaveBeenCalledWith({ org_id: org.id, article_id: article.id });
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'article.images_replay',
        before: { images_status: 'failed' },
      }),
    );
  });

  test('unknown article -> 404, nothing enqueued', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(null);
    const res = await client.admin.v0.articles[':article_id'].images.$post(
      { param: { article_id: 'f'.repeat(24) } },
      await authed(),
    );
    expect(res.status).toBe(404);
    expect(enqueueImageTask).not.toHaveBeenCalled();
  });
});
