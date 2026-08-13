import type { Article } from '@shared/schemas';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  editWordPressArticle,
  getWordPressCapabilities,
  submitWordPressArticle,
  testWordPressIntegration,
} from '../src/clients/wordpress';
import { config } from '../src/config';

const fetchMock = vi.fn();

const article: Article = {
  id: 'article-1',
  org_id: 'org-1',
  keyword_id: 'keyword-1',
  title: 'WordPress Article',
  meta_title: 'Meta title must not be sent',
  slug: 'wordpress-article',
  keyword: 'wordpress publishing',
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  meta_description: 'Article description',
  featured_image_url: 'https://cdn.example/cover.png',
  content: '# Heading\n\nBody with **bold**.\n\n![Diagram](https://cdn.example/image.png)',
  difficulty: 20,
  search_volume: 100,
  status: 'generated',
  created_at: new Date('2026-07-02T08:00:00.000Z'),
  updated_at: null,
  published_at: null,
  images: [],
  images_status: 'complete',
  publications: [],
  auto_publish: { preflight_error: null, attempts: [] },
  video: null,
};

describe('WordPress client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('calls the SEO Potion test route with only the token JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn(async () => ({ success: true, message: 'Integration test successful' })),
    });

    await expect(
      testWordPressIntegration('https://example.com/', 'wordpress-token'),
    ).resolves.toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://example.com/wp-json/seo-potion/v1/test-integration');
    expect(init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'wordpress-token' }),
    });
    expect(init.headers).not.toHaveProperty('X-Secret-Key');
  });

  test.each([
    'invalid_integration_key',
    'integration_not_configured',
  ])('returns the plugin error code %s', async (error_code) => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: vi.fn(async () => ({ success: false, error_code })),
    });

    await expect(testWordPressIntegration('https://example.com', 'bad-token')).resolves.toEqual({
      success: false,
      error_code,
    });
  });

  test('throws when the plugin response does not match its contract', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: vi.fn(async () => ({ error: 'server failure' })),
    });

    await expect(testWordPressIntegration('https://example.com', 'token')).rejects.toThrow(
      'Invalid WordPress integration response',
    );
  });

  test('propagates network failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(testWordPressIntegration('https://example.com', 'token')).rejects.toThrow(
      'network down',
    );
  });

  test('submits the exact mapped payload with both secrets and rendered image HTML', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn(async () => ({ success: true, post_id: 321 })),
    });

    await expect(
      submitWordPressArticle('https://example.com/', 'site-token', article),
    ).resolves.toEqual({ status: 200, body: { success: true, post_id: 321 } });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://example.com/wp-json/seo-potion/v1/submit');
    expect(init).toEqual({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Secret-Key': config.WORDPRESS_ROUTE_SECRET,
      },
      body: JSON.stringify({
        secret: 'site-token',
        title: 'WordPress Article',
        slug: 'wordpress-article',
        created_at: '2026-07-02T08:00:00.000Z',
        content:
          '<h1>Heading</h1>\n<p>Body with <strong>bold</strong>.</p>\n<p><img src="https://cdn.example/image.png" alt="Diagram"></p>\n',
        image_url: 'https://cdn.example/cover.png',
        meta_description: 'Article description',
        focus_keyword: 'wordpress publishing',
      }),
    });
    const payload = JSON.parse(init.body);
    expect(payload.content).toContain('<img src="https://cdn.example/image.png" alt="Diagram">');
    expect(payload).not.toHaveProperty('author');
    expect(payload).not.toHaveProperty('category');
    expect(payload).not.toHaveProperty('tags');
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('focus_keyphrase');
    expect(payload).not.toHaveProperty('meta_title');
  });

  test('automatic submit sends a stable source id and explicitly requests a live post', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn(async () => ({
        success: true,
        post_id: 321,
        slug: 'wordpress-article-2',
        permalink: 'https://example.com/wordpress-article-2/',
        post_status: 'publish',
      })),
    });

    await expect(
      submitWordPressArticle('https://example.com', 'site-token', article, {
        sourceArticleId: article.id,
        status: 'publish',
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        success: true,
        post_id: 321,
        slug: 'wordpress-article-2',
        permalink: 'https://example.com/wordpress-article-2/',
        post_status: 'publish',
      },
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init.body)).toMatchObject({
      source_article_id: 'article-1',
      status: 'publish',
    });
  });

  test('reads the plugin idempotent-publish capability contract', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn(async () => ({
        version: '1.1.0',
        capabilities: ['submit', 'edit', 'idempotent_publish'],
      })),
    });

    await expect(getWordPressCapabilities('https://example.com/')).resolves.toEqual({
      version: '1.1.0',
      capabilities: ['submit', 'edit', 'idempotent_publish'],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://example.com/wp-json/seo-potion/v1/capabilities',
    );
  });

  test('treats a missing capabilities endpoint as a legacy plugin', async () => {
    fetchMock.mockResolvedValueOnce({ status: 404 });

    await expect(getWordPressCapabilities('https://example.com')).resolves.toBeNull();
  });

  test('updates by stored WordPress ID with the current mutable snapshot and no status', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn(async () => ({
        success: true,
        post_id: 321,
        warnings: ['Content images could not be localized.'],
      })),
    });

    await expect(
      editWordPressArticle('https://example.com', 'site-token', 321, article),
    ).resolves.toEqual({
      status: 200,
      body: {
        success: true,
        post_id: 321,
        warnings: ['Content images could not be localized.'],
      },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://example.com/wp-json/seo-potion/v1/edit');
    expect(init).toEqual({
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Secret-Key': config.WORDPRESS_ROUTE_SECRET,
      },
      body: JSON.stringify({
        secret: 'site-token',
        id: 321,
        title: 'WordPress Article',
        slug: 'wordpress-article',
        content:
          '<h1>Heading</h1>\n<p>Body with <strong>bold</strong>.</p>\n<p><img src="https://cdn.example/image.png" alt="Diagram"></p>\n',
        image_url: 'https://cdn.example/cover.png',
        meta_description: 'Article description',
        focus_keyword: 'wordpress publishing',
      }),
    });
    const payload = JSON.parse(init.body);
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('meta_title');
  });

  test('omits image_url when the article has no featured image', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn(async () => ({ success: true, post_id: 322 })),
    });

    await submitWordPressArticle('https://example.com', 'site-token', {
      ...article,
      featured_image_url: '',
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init.body)).not.toHaveProperty('image_url');
  });

  test.each([
    400, 403, 404, 409, 500,
  ] as const)('preserves a plugin %s error response', async (status) => {
    fetchMock.mockResolvedValueOnce({
      status,
      json: vi.fn(async () => ({ error: `plugin-${status}` })),
    });

    await expect(
      submitWordPressArticle('https://example.com', 'site-token', article),
    ).resolves.toEqual({ status, body: { error: `plugin-${status}` } });
  });
});
