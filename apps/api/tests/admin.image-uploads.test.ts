import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ArticleSchema } from '@shared/schemas';
import { sign } from 'hono/jwt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => {
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  return {
    ArticleRepo: { findById: vi.fn(), saveManualImage: vi.fn() },
    OrgRepo: { findById: vi.fn() },
    AdminActionRepo: { insert: vi.fn() },
  };
});
vi.mock('@shared/db', () => repos);

import app from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';
import { ArticleDetailResponse } from '../src/admin/schemas';
import { getAdminJwtSecret } from '../src/admin/secret';
import { signToken } from '../src/auth/jwt';
import { submitWordPressArticle } from '../src/clients/wordpress';
import { manifestEntry, renderArticle } from '../src/lib/static-site';

const send = vi.fn();
vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=',
  'base64',
);
const original = ArticleSchema.parse({
  id: 'b'.repeat(24),
  org_id: 'a'.repeat(24),
  keyword_id: null,
  keyword: 'guide',
  title: 'Guide',
  meta_title: 'Guide',
  slug: 'guide',
  meta_description: 'A guide',
  content: '# Guide\n\n```md\n## Code\n```\n\n## First\n\nText\n\n## Second\n\nMore\n\n## Third\n',
  featured_image_url: '',
  images: [],
  images_status: 'complete',
  difficulty: null,
  search_volume: null,
  status: 'generated',
  created_at: new Date(),
  published_at: null,
});
let article = structuredClone(original);
const metadata = {
  role: 'cover',
  section_heading: null,
  alt: 'A mountain lake',
  content_type: 'image/png',
  size: png.length,
};

async function request(action: string, body: unknown, auth?: string, id = article.id) {
  return app.request(`/admin/v0/articles/${id}/images/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth ?? (await signAdminToken('op@example.com'))}`,
    },
    body: JSON.stringify(body),
  });
}
async function prepare(overrides = {}) {
  const response = await request('upload', { ...metadata, ...overrides });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    upload_token: string;
    upload_url: string;
    headers: Record<string, string>;
  }>;
}
async function finish(overrides = {}) {
  const prepared = await prepare(overrides);
  const response = await request('finalize', { upload_token: prepared.upload_token });
  expect(response.status).toBe(200);
  return { prepared, result: ArticleDetailResponse.parse(await response.json()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('IMAGES_BUCKET', 'stage-images');
  vi.stubEnv('IMAGES_CDN_DOMAIN', 'stage-images.example.com');
  article = structuredClone(original);
  repos.ArticleRepo.findById.mockImplementation(async (id) => (id === article.id ? article : null));
  repos.OrgRepo.findById.mockResolvedValue({ id: article.org_id });
  repos.ArticleRepo.saveManualImage.mockImplementation(
    async (_before, images, content, featured_image_url) => {
      article = { ...article, images, content, featured_image_url, updated_at: new Date() };
      return article;
    },
  );
  send.mockResolvedValue({
    ContentLength: png.length,
    ContentType: 'image/png',
    Body: { transformToByteArray: async () => png, destroy: vi.fn() },
  });
});

describe('manual article image uploads', () => {
  test.each(['upload', 'finalize'])('%s requires an admin operator', async (action) => {
    for (const auth of [
      'invalid',
      await signToken({ sub: 'user', email: 'user@example.com' }),
      await sign(
        { sub: 'viewer', email: 'viewer@example.com', role: 'viewer' },
        await getAdminJwtSecret(),
      ),
    ]) {
      expect((await request(action, metadata, auth)).status).toBe(401);
    }
    expect(repos.ArticleRepo.findById).not.toHaveBeenCalled();
  });

  test.each([
    'upload',
    'finalize',
  ])('%s rejects missing, deleted, generated articles and missing orgs', async (action) => {
    const body = action === 'upload' ? metadata : { upload_token: 'invalid' };
    expect((await request(action, body, undefined, 'missing')).status).toBe(404);
    article.status = 'deleted';
    expect((await request(action, body)).status).toBe(404);
    article.status = 'generated';
    article.keyword_id = 'planner-keyword';
    expect((await request(action, body)).status).toBe(409);
    article.keyword_id = null;
    repos.OrgRepo.findById.mockResolvedValue(null);
    expect((await request(action, body)).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  test.each([
    { content_type: 'image/svg+xml' },
    { content_type: 'text/html' },
    { size: 0 },
    { size: 5 * 1024 * 1024 + 1 },
    { size: 1.5 },
    { alt: '  ' },
    { alt: 'x\ny' },
    { role: 'avatar' },
    { key: 'other/article.png' },
  ])('rejects invalid file or metadata %j', async (overrides) => {
    expect((await request('upload', { ...metadata, ...overrides })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  test('prepares unique article-scoped immutable uploads with signed size, type and overwrite guard', async () => {
    const first = await prepare();
    const second = await prepare();
    const url = new URL(first.upload_url);
    expect(url.pathname).toMatch(new RegExp(`^/articles/${article.id}/manual-[a-f0-9-]+\\.png$`));
    expect(url.host).toContain('stage-images');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'if-none-match', 'cache-control']),
    );
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
    expect(first.headers).toMatchObject({
      'Content-Type': 'image/png',
      'If-None-Match': '*',
      'Cache-Control': expect.stringContaining('immutable'),
    });
    expect(first.upload_url).not.toBe(second.upload_url);
    expect(article.images_status).toBe('complete');
    expect(repos.ArticleRepo.saveManualImage).not.toHaveBeenCalled();
  });

  test('finalizes a cover with truthful structured metadata, without changing Markdown', async () => {
    const { result } = await finish();
    expect(result.featured_image_url).toMatch(
      new RegExp(`^https://stage-images.example.com/articles/${article.id}/manual-`),
    );
    expect(result.images).toEqual([
      {
        role: 'cover',
        section_heading: null,
        alt: metadata.alt,
        url: result.featured_image_url,
        prompt: '',
        model: null,
        seed: null,
        generated_at: null,
        width: 1,
        height: 1,
      },
    ]);
    expect(result.content).toBe(original.content);
    expect(result.images_status).toBe('complete');
    expect(result.image_headings).toEqual(['First', 'Second', 'Third']);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: 'stage-images',
      Key: expect.stringContaining(`articles/${article.id}/manual-`),
    });
  });

  test('injects escaped inline alt once after the chosen H2 and retries idempotently', async () => {
    const { prepared, result } = await finish({
      role: 'inline',
      section_heading: 'Second',
      alt: 'Lake [view] <sun>',
    });
    expect(result.content).toContain(
      `## Second\n\n![Lake \\[view\\] \\<sun\\>](${result.images[0]?.url})`,
    );
    expect(result.featured_image_url).toBe('');
    const retry = await request('finalize', { upload_token: prepared.upload_token });
    expect(retry.status).toBe(200);
    expect(ArticleDetailResponse.parse(await retry.json()).content).toBe(result.content);
    expect(repos.ArticleRepo.saveManualImage).toHaveBeenCalledTimes(1);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledTimes(1);
  });

  test('replaces a slot and cannot replay an older replacement', async () => {
    const first = await finish({ role: 'inline', section_heading: 'First' });
    await finish({ role: 'inline', section_heading: 'Second' });
    await finish({ role: 'inline', section_heading: 'First', alt: 'Replacement' });
    expect(article.images).toHaveLength(2);
    expect(article.content).not.toContain(first.result.images[0]?.url);
    expect((await request('finalize', { upload_token: first.prepared.upload_token })).status).toBe(
      409,
    );
  });

  test.each([
    true,
    false,
  ])('supports eight images with cover=%s and rejects a ninth', async (withCover) => {
    article.content = Array.from({ length: 9 }, (_, i) => `## Section ${i}`).join('\n\n');
    if (withCover) await finish();
    for (let i = 0; i < (withCover ? 7 : 8); i++) {
      await finish({ role: 'inline', section_heading: `Section ${i}` });
    }
    expect(article.images).toHaveLength(8);
    expect(article.content.match(/!\[/g)).toHaveLength(withCover ? 7 : 8);
    expect(article.images_status).toBe('complete');
    expect(
      (await request('upload', { ...metadata, role: 'inline', section_heading: 'Section 8' }))
        .status,
    ).toBe(409);
    if (!withCover) expect((await request('upload', metadata)).status).toBe(409);
    await finish({ role: 'inline', section_heading: 'Section 0', alt: 'Replacement' });
    expect(article.images).toHaveLength(8);
  });

  test('finalization rechecks capacity if other uploads fill the article first', async () => {
    article.content = Array.from({ length: 9 }, (_, i) => `## Section ${i}`).join('\n\n');
    const prepared = await prepare({ role: 'inline', section_heading: 'Section 8' });
    for (let i = 0; i < 8; i++) await finish({ role: 'inline', section_heading: `Section ${i}` });
    expect((await request('finalize', { upload_token: prepared.upload_token })).status).toBe(409);
    expect(article.images).toHaveLength(8);
  });

  test('rejects nonexistent, code-fenced, duplicate H2s and cover placement metadata', async () => {
    article.content += '\n## Duplicate\n\n## Duplicate\n';
    for (const heading of ['Missing', 'Code', 'Duplicate']) {
      expect(
        (await request('upload', { ...metadata, role: 'inline', section_heading: heading })).status,
      ).toBe(400);
    }
    expect((await request('upload', { ...metadata, section_heading: 'First' })).status).toBe(400);
  });

  test('revalidates placement and refuses concurrent edits without overwriting them', async () => {
    const prepared = await prepare({ role: 'inline', section_heading: 'First' });
    article.content = '## Changed';
    expect((await request('finalize', { upload_token: prepared.upload_token })).status).toBe(400);
    article.content = original.content;
    repos.ArticleRepo.saveManualImage.mockResolvedValueOnce(null);
    expect((await request('finalize', { upload_token: prepared.upload_token })).status).toBe(409);
  });

  test('binds finalization to operator, article, org and stage; rejects tampering and expiry', async () => {
    const { upload_token } = await prepare();
    expect(
      (await request('finalize', { upload_token }, await signAdminToken('other@example.com')))
        .status,
    ).toBe(400);
    article.org_id = 'another-org';
    expect((await request('finalize', { upload_token })).status).toBe(400);
    article.org_id = original.org_id;
    article.id = 'c'.repeat(24);
    expect((await request('finalize', { upload_token })).status).toBe(400);
    article.id = original.id;
    vi.stubEnv('IMAGES_BUCKET', 'production-images');
    expect((await request('finalize', { upload_token })).status).toBe(400);
    vi.stubEnv('IMAGES_BUCKET', 'stage-images');
    expect((await request('finalize', { upload_token: `${upload_token}x` })).status).toBe(400);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 901_000);
      expect((await request('finalize', { upload_token })).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
    expect(send).not.toHaveBeenCalled();
  });

  test('upload tokens cannot authenticate as admin tokens', async () => {
    const { upload_token } = await prepare();
    expect((await request('upload', metadata, upload_token)).status).toBe(401);
  });

  test.each([
    { ContentLength: png.length + 1 },
    { ContentType: 'text/html' },
    { Body: { transformToByteArray: async () => Buffer.from('not an image') } },
  ])('rejects invalid S3 objects %j', async (overrides) => {
    const { upload_token } = await prepare();
    send.mockResolvedValueOnce({
      ContentLength: png.length,
      ContentType: 'image/png',
      Body: { transformToByteArray: async () => png, destroy: vi.fn() },
      ...overrides,
    });
    expect((await request('finalize', { upload_token })).status).toBe(400);
    expect(repos.ArticleRepo.saveManualImage).not.toHaveBeenCalled();
    expect(article.images_status).toBe('complete');
  });

  test('missing upload is retryable and missing storage fails without changing the article', async () => {
    const { upload_token } = await prepare();
    send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    expect((await request('finalize', { upload_token })).status).toBe(400);
    vi.stubEnv('IMAGES_BUCKET', '');
    expect((await request('upload', metadata)).status).toBe(503);
    expect(repos.ArticleRepo.saveManualImage).not.toHaveBeenCalled();
  });

  test('manual cover and inline metadata flow into static-site publishing', async () => {
    await finish();
    await finish({ role: 'inline', section_heading: 'First' });
    const entry = { article, slug: article.slug, published_at: new Date(), updated_at: null };
    const markdown = renderArticle(entry);
    const manifest = manifestEntry(entry, 'blog');
    expect(markdown).toContain(article.featured_image_url);
    expect(markdown).toContain(article.images[1]?.url);
    expect(JSON.stringify(manifest)).toContain(article.images[1]?.url);
    expect(JSON.stringify(manifest)).toContain(metadata.alt);
  });

  test('WordPress receives the cover URL and inline HTML for media import', async () => {
    await finish();
    await finish({ role: 'inline', section_heading: 'First', alt: 'Lake [view]' });
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, post_id: 12 }), { status: 200 }),
      );
    try {
      await submitWordPressArticle('https://wordpress.example.com', 'site-token', article);
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      expect(body.image_url).toBe(article.featured_image_url);
      expect(body.content).toContain(`src="${article.images[1]?.url}" alt="Lake [view]"`);
      expect(body.content).not.toContain(article.featured_image_url);
    } finally {
      fetch.mockRestore();
    }
  });
});
