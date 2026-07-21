import type { CreateArticleInput } from '@shared/schemas';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ArticleRepo } from '../src/repositories/article.repo';

const base = (over: Partial<CreateArticleInput>): CreateArticleInput => ({
  org_id: 'org_art',
  keyword_id: 'k1',
  title: 'T',
  meta_title: 'T meta',
  slug: 's',
  keyword: 'kw',
  meta_description: 'm',
  featured_image_url: 'https://x/i.png',
  content: '# body',
  difficulty: 10,
  search_volume: 20,
  status: 'generated',
  published_at: null,
  ...over,
});

describe('ArticleRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('articles').deleteMany({});
    await ArticleRepo.create(base({ slug: 'a', status: 'generated' }));
    await ArticleRepo.create(base({ slug: 'b', status: 'published', published_at: new Date() }));
  });

  afterAll(async () => {
    await closeDb();
  });

  test('listByOrg returns filtered rows + total', async () => {
    const all = await ArticleRepo.listByOrg('org_art', { limit: 20, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.articles).toHaveLength(2);

    const published = await ArticleRepo.listByOrg('org_art', {
      status: 'published',
      limit: 20,
      offset: 0,
    });
    expect(published.total).toBe(1);
    expect(published.articles[0]!.status).toBe('published');
  });

  test('countByStatus counts per status', async () => {
    expect(await ArticleRepo.countByStatus('org_art', 'published')).toBe(1);
    expect(await ArticleRepo.countByStatus('org_art', 'generated')).toBe(1);
  });

  test('findById round-trips, returns null for unknown/invalid id', async () => {
    const { articles } = await ArticleRepo.listByOrg('org_art', { limit: 1, offset: 0 });
    const found = await ArticleRepo.findById(articles[0]!.id);
    expect(found?.id).toBe(articles[0]!.id);
    expect(await ArticleRepo.findById('not-an-objectid')).toBeNull();
  });

  test('setWordPressPostId reports whether a document matched', async () => {
    const { articles } = await ArticleRepo.listByOrg('org_art', { limit: 1, offset: 0 });
    const id = articles[0]!.id;

    expect(await ArticleRepo.setWordPressPostId(id, 42)).toBe(true);
    expect((await ArticleRepo.findById(id))?.wordpress_post_id).toBe(42);

    // Valid ObjectId that matches no document, and a malformed id -> false.
    expect(await ArticleRepo.setWordPressPostId('ffffffffffffffffffffffff', 7)).toBe(false);
    expect(await ArticleRepo.setWordPressPostId('not-an-objectid', 7)).toBe(false);
  });
});
