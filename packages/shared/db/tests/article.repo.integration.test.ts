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

  test('recordPublication pushes once, then updates in place (#7)', async () => {
    const created = await ArticleRepo.create(base({ slug: 'publishable' }));
    // Pre-#7 documents have no `publications` field at all; the default fills in.
    expect(created.publications).toEqual([]);

    expect(
      await ArticleRepo.recordPublication(created.id, {
        provider: 'wordpress',
        ref: '42',
        slug: 'publishable',
      }),
    ).toBe(true);
    const first = (await ArticleRepo.findById(created.id))!.publications;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ provider: 'wordpress', ref: '42', updated_at: null });
    expect(first[0]!.published_at).toBeInstanceOf(Date);

    // A republish under a renamed slug updates the same entry — it must not
    // accumulate a second row for the provider.
    await ArticleRepo.recordPublication(created.id, {
      provider: 'wordpress',
      ref: '42',
      slug: 'renamed',
    });
    const second = (await ArticleRepo.findById(created.id))!.publications;
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ slug: 'renamed' });
    expect(second[0]!.updated_at).toBeInstanceOf(Date);
    // published_at keeps meaning "first went live".
    expect(second[0]!.published_at).toEqual(first[0]!.published_at);

    // A second provider is a second entry, not a replacement.
    await ArticleRepo.recordPublication(created.id, {
      provider: 'static-site',
      ref: 'abc123sha',
      slug: 'renamed',
    });
    expect((await ArticleRepo.findById(created.id))!.publications).toHaveLength(2);
  });

  test('recordPublication reports false for unknown/invalid ids', async () => {
    const entry = { provider: 'wordpress' as const, ref: '1', slug: 's' };
    expect(await ArticleRepo.recordPublication('ffffffffffffffffffffffff', entry)).toBe(false);
    expect(await ArticleRepo.recordPublication('not-an-objectid', entry)).toBe(false);
  });

  test('recordPublication stores a caller-supplied timestamp (#7)', async () => {
    const at = new Date('2026-07-30T12:00:00.000Z');
    const created = await ArticleRepo.create(base({ org_id: 'org_at', slug: 'stamped' }));
    const entry = { provider: 'static-site' as const, ref: 'sha1', slug: 'stamped' };

    // The publisher passes the timestamp it already committed into manifest.json.
    await ArticleRepo.recordPublication(created.id, entry, at);
    expect((await ArticleRepo.findById(created.id))!.publications[0]!.published_at).toEqual(at);

    const later = new Date('2026-07-31T12:00:00.000Z');
    await ArticleRepo.recordPublication(created.id, { ...entry, ref: 'sha2' }, later);
    const updated = (await ArticleRepo.findById(created.id))!.publications[0]!;
    expect(updated.updated_at).toEqual(later);
    expect(updated.published_at).toEqual(at);
  });

  test('listPublishedTo returns only what is live with that provider (#7)', async () => {
    const org = 'org_live';
    const wanted = await ArticleRepo.create(base({ org_id: org, slug: 'live' }));
    const otherProvider = await ArticleRepo.create(base({ org_id: org, slug: 'wp-only' }));
    const removed = await ArticleRepo.create(base({ org_id: org, slug: 'gone' }));
    await ArticleRepo.create(base({ org_id: org, slug: 'never-published' }));
    await ArticleRepo.create(base({ org_id: 'org_elsewhere', slug: 'other-org' }));

    for (const id of [wanted.id, removed.id]) {
      await ArticleRepo.recordPublication(id, {
        provider: 'static-site',
        ref: 'sha',
        slug: 'whatever',
      });
    }
    await ArticleRepo.recordPublication(otherProvider.id, {
      provider: 'wordpress',
      ref: '9',
      slug: 'wp-only',
    });
    // An unpublished article must drop out of the manifest the next publish builds.
    await (await getDb())
      .collection('articles')
      .updateOne({ slug: 'gone', org_id: org }, { $set: { status: 'deleted' } });

    const live = await ArticleRepo.listPublishedTo(org, 'static-site');
    expect(live.map((a) => a.slug)).toEqual(['live']);
  });

  test('create leaves updated_at null until the first edit', async () => {
    const created = await ArticleRepo.create(base({ slug: 'fresh' }));
    expect(created.updated_at).toBeNull();
  });

  test('updateContent writes the editable fields and stamps updated_at', async () => {
    const created = await ArticleRepo.create(base({ slug: 'editable' }));
    const updated = await ArticleRepo.updateContent(created.id, {
      title: 'New title',
      slug: 'new-slug',
      meta_title: 'New meta title',
      meta_description: 'New meta description',
      content: '# new body',
    });

    expect(updated).not.toBeNull();
    expect(updated).toMatchObject({
      id: created.id,
      title: 'New title',
      slug: 'new-slug',
      meta_title: 'New meta title',
      meta_description: 'New meta description',
      content: '# new body',
    });
    expect(updated?.updated_at).toBeInstanceOf(Date);
    // Untouched fields survive the $set.
    expect(updated?.org_id).toBe(created.org_id);
    expect(updated?.status).toBe(created.status);

    // Persisted, not just echoed back.
    const reread = await ArticleRepo.findById(created.id);
    expect(reread?.title).toBe('New title');
    expect(reread?.updated_at).toEqual(updated?.updated_at);
  });

  test('updateContent returns null for unknown/invalid id', async () => {
    const patch = {
      title: 'x',
      slug: 'x',
      meta_title: 'x',
      meta_description: 'x',
      content: 'x',
    };
    expect(await ArticleRepo.updateContent('not-an-objectid', patch)).toBeNull();
    expect(await ArticleRepo.updateContent('ffffffffffffffffffffffff', patch)).toBeNull();
  });
});
