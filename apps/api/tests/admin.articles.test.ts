import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: { findById: vi.fn() },
  ArticleRepo: {
    create: vi.fn(),
    findById: vi.fn(),
    listByOrg: vi.fn(),
    updateContent: vi.fn(),
    setWordPressPostId: vi.fn(),
    recordPublication: vi.fn(),
  },
  KeywordRepo: {
    deleteUnstarted: vi.fn(),
    findById: vi.fn(),
    findByOrgAndDate: vi.fn(),
    listByOrg: vi.fn(),
    reschedulePending: vi.fn(),
    resetGeneration: vi.fn(),
    updateBrief: vi.fn(),
  },
  AdminActionRepo: { insert: vi.fn() },
  PromoCodeRepo: {
    create: vi.fn(),
    findByCode: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    deactivate: vi.fn(),
  },
  PromoRedemptionRepo: { countConfirmed: vi.fn(), listByCode: vi.fn() },
}));
vi.mock('@shared/db', () => repos);

const wp = vi.hoisted(() => ({
  submitWordPressArticle: vi.fn(),
  editWordPressArticle: vi.fn(),
}));
vi.mock('../src/clients/wordpress', () => wp);

const { launchImageRepair } = vi.hoisted(() => ({
  launchImageRepair: vi.fn(async () => ({ run_id: 'run_1' })),
}));
vi.mock('@shared/articles', () => ({ launchImageRepair }));

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

const createBody = {
  keyword: '  crm software  ',
  title: 'CRM Software Guide',
  slug: 'crm-software-guide',
  meta_title: 'CRM Software Guide for Growing Teams',
  meta_description: 'M'.repeat(130),
  content: '# CRM Software Guide\n\nStandalone body.',
};

const standaloneArticle = (keyword: string | null = 'crm software') => ({
  ...article,
  id: 'c'.repeat(24),
  keyword_id: null,
  keyword,
  title: createBody.title,
  slug: createBody.slug,
  meta_title: createBody.meta_title,
  meta_description: createBody.meta_description,
  content: createBody.content,
  search_volume: null,
  difficulty: null,
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  featured_image_url: '',
  images: [],
  images_status: 'complete' as const,
  video: null,
  readability: null,
});

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

  test('rows expose nullable standalone article fields', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.ArticleRepo.listByOrg.mockResolvedValueOnce({
      articles: [{ ...article, keyword_id: null, keyword: null, search_volume: null }],
      total: 1,
    });

    const res = await client.admin.v0.orgs[':org_id'].articles.$get(
      { param: { org_id: org.id }, query: {} },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).articles[0]).toMatchObject({ keyword: null, search_volume: null });
  });
});

describe('POST /admin/v0/orgs/{org_id}/articles', () => {
  const create = async (
    org_id: string,
    body: { keyword: string | null } & Omit<typeof createBody, 'keyword'> = createBody,
  ) =>
    client.admin.v0.orgs[':org_id'].articles.$post(
      { param: { org_id }, json: body },
      await authed(),
    );

  test('creates a standalone article with a trimmed keyword, exact defaults, and audit record', async () => {
    const created = standaloneArticle();
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.ArticleRepo.create.mockResolvedValueOnce(created);

    const res = await create(org.id);

    expect(res.status).toBe(201);
    if (res.status !== 201) throw new Error('expected 201');
    expect(await res.json()).toMatchObject({
      id: created.id,
      keyword_id: null,
      keyword: 'crm software',
      title: createBody.title,
      images_status: 'complete',
    });
    expect(repos.ArticleRepo.create).toHaveBeenCalledWith({
      org_id: org.id,
      keyword_id: null,
      keyword: 'crm software',
      title: createBody.title,
      slug: createBody.slug,
      meta_title: createBody.meta_title,
      meta_description: createBody.meta_description,
      content: createBody.content,
      search_volume: null,
      difficulty: null,
      topic_cluster_id: null,
      topic_cluster_label: null,
      topic_role: null,
      topic_content_focus: null,
      topic_primary_keyword: null,
      featured_image_url: '',
      images: [],
      images_status: 'complete',
      video: null,
      readability: null,
      status: 'generated',
      published_at: null,
    });
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith({
      actor: 'op@example.com',
      action: 'article.create_manual',
      org_id: org.id,
      entity: { type: 'article', id: created.id },
      payload: createBody,
      before: null,
    });
    for (const interaction of Object.values(repos.KeywordRepo)) {
      expect(interaction).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['null', null, null],
    ['whitespace', ' \t ', null],
  ])('stores a %s keyword as null', async (_name, keyword, storedKeyword) => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.ArticleRepo.create.mockResolvedValueOnce(standaloneArticle(storedKeyword));

    const res = await create(org.id, { ...createBody, keyword });

    expect(res.status).toBe(201);
    expect(repos.ArticleRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: storedKeyword }),
    );
  });

  test('missing org returns 404 without writing or auditing', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(null);

    const res = await create('f'.repeat(24));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(repos.ArticleRepo.create).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('structurally invalid input uses the documented field-error response', async () => {
    const token = await signAdminToken('op@example.com');
    const res = await adminApp.request(`/admin/v0/orgs/${org.id}/articles`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keyword: null }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      fields: Record<string, string>;
    };
    expect(body.error).toBe('validation_failed');
    expect(Object.keys(body.fields).sort()).toEqual([
      'content',
      'meta_description',
      'meta_title',
      'slug',
      'title',
    ]);
    expect(repos.OrgRepo.findById).not.toHaveBeenCalled();
    expect(repos.ArticleRepo.create).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test.each([
    ['title required', { title: '   ' }, 'title', 'Title is required'],
    ['slug required', { slug: '   ' }, 'slug', 'Slug is required'],
    [
      'slug format',
      { slug: 'nested/article' },
      'slug',
      'Slug must be one path segment containing letters, numbers, and hyphens',
    ],
    ['content required', { content: ' \n ' }, 'content', 'Content is required'],
    ['meta title required', { meta_title: '   ' }, 'meta_title', 'Meta title is required'],
    [
      'meta title maximum',
      { meta_title: 'x'.repeat(61) },
      'meta_title',
      'Meta title must be 60 characters or fewer',
    ],
    [
      'meta description required',
      { meta_description: '   ' },
      'meta_description',
      'Meta description is required',
    ],
    [
      'meta description minimum',
      { meta_description: 'x'.repeat(119) },
      'meta_description',
      'Meta description must be between 120 and 160 characters',
    ],
    [
      'meta description maximum',
      { meta_description: 'x'.repeat(161) },
      'meta_description',
      'Meta description must be between 120 and 160 characters',
    ],
  ])('%s returns its field error without persistence or audit', async (_name, patch, field, error) => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);

    const res = await create(org.id, { ...createBody, ...patch });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'validation_failed', fields: { [field]: error } });
    expect(repos.ArticleRepo.create).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('audit insertion failure still returns the created article with 201', async () => {
    const created = standaloneArticle();
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.ArticleRepo.create.mockResolvedValueOnce(created);
    repos.AdminActionRepo.insert.mockRejectedValueOnce(new Error('mongo down'));

    const res = await create(org.id);

    expect(res.status).toBe(201);
    if (res.status === 201) expect((await res.json()).id).toBe(created.id);
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

  test('returns nullable keyword linkage for a standalone article', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce({
      ...article,
      keyword_id: null,
      keyword: null,
      search_volume: null,
    });
    const res = await client.admin.v0.articles[':article_id'].$get(
      { param: { article_id: article.id } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    expect(await res.json()).toMatchObject({ keyword_id: null, keyword: null });
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

  test('customer slug-format validation applies -> 400 with fields', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce(article);
    const res = await patch(article.id, { ...editBody, slug: 'nested/article' });
    expect(res.status).toBe(400);
    if (res.status !== 400) throw new Error('expected 400');
    expect((await res.json()).fields.slug).toContain('one path segment');
    expect(repos.ArticleRepo.updateContent).not.toHaveBeenCalled();
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
    expect(launchImageRepair).toHaveBeenCalledWith(org.id, article.id);
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
    expect(launchImageRepair).not.toHaveBeenCalled();
  });

  test('standalone article -> 409 images_not_supported without launch or audit', async () => {
    repos.ArticleRepo.findById.mockResolvedValueOnce({ ...article, keyword_id: null });

    const res = await client.admin.v0.articles[':article_id'].images.$post(
      { param: { article_id: article.id } },
      await authed(),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'images_not_supported' });
    expect(launchImageRepair).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});
