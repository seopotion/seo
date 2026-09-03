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

  test('findLatestForKeywordSince scopes by org + keyword and ignores older articles (#67)', async () => {
    const before = new Date(Date.now() - 60_000);
    const older = await ArticleRepo.create(base({ org_id: 'org_since', keyword_id: 'k_since' }));
    const runStart = new Date();
    await ArticleRepo.create(base({ org_id: 'other_org', keyword_id: 'k_since', slug: 'x' }));
    await ArticleRepo.create(base({ org_id: 'org_since', keyword_id: 'k_other', slug: 'y' }));

    expect(
      await ArticleRepo.findLatestForKeywordSince('org_since', 'k_since', runStart),
    ).toBeNull();
    expect((await ArticleRepo.findLatestForKeywordSince('org_since', 'k_since', before))?.id).toBe(
      older.id,
    );

    const mine = await ArticleRepo.create(
      base({ org_id: 'org_since', keyword_id: 'k_since', slug: 'z' }),
    );
    expect(
      (await ArticleRepo.findLatestForKeywordSince('org_since', 'k_since', runStart))?.id,
    ).toBe(mine.id);
  });

  test('topic metadata round-trips and published cluster lookup stays org-scoped', async () => {
    const topic = {
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: 'support' as const,
      topic_content_focus: 'How to prevent membrane fouling',
      topic_primary_keyword: 'prevent membrane fouling',
    };
    const wanted = await ArticleRepo.create(
      base({
        ...topic,
        org_id: 'org_topic',
        slug: 'wanted-topic',
        status: 'published',
        published_at: new Date(),
      }),
    );
    await ArticleRepo.create(
      base({
        ...topic,
        org_id: 'other_org',
        slug: 'cross-org-topic',
        status: 'published',
        published_at: new Date(),
      }),
    );
    await ArticleRepo.create(base({ ...topic, org_id: 'org_topic', slug: 'not-published' }));

    expect(wanted).toMatchObject(topic);
    const rows = await ArticleRepo.listPublishedByTopicCluster(
      'org_topic',
      topic.topic_cluster_id,
      { limit: 25 },
    );
    expect(rows.map((article) => article.slug)).toEqual(['wanted-topic']);
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

  test('recordPublication advances status to published and stamps published_at', async () => {
    const created = await ArticleRepo.create(base({ org_id: 'org_status', slug: 'goes-live' }));
    expect(created.status).toBe('generated');
    expect(created.published_at).toBeNull();

    const at = new Date('2026-08-01T10:00:00.000Z');
    await ArticleRepo.recordPublication(
      created.id,
      { provider: 'static-site', ref: 'sha1', slug: 'goes-live' },
      { publishedAt: at, updatedAt: null },
    );

    // Nothing used to write this, which left Content History, the published
    // counter, the GSC title join and the admin count permanently empty.
    const live = (await ArticleRepo.findById(created.id))!;
    expect(live.status).toBe('published');
    expect(live.published_at).toEqual(at);

    // A republish must not move published_at — it means "first went live".
    const later = new Date('2026-08-02T10:00:00.000Z');
    await ArticleRepo.recordPublication(
      created.id,
      { provider: 'static-site', ref: 'sha2', slug: 'goes-live' },
      { updatedAt: later },
    );
    const republished = (await ArticleRepo.findById(created.id))!;
    expect(republished.status).toBe('published');
    expect(republished.published_at).toEqual(at);

    // Nor does a SECOND provider going live later reset it.
    await ArticleRepo.recordPublication(
      created.id,
      { provider: 'wordpress', ref: '99', slug: 'goes-live' },
      { publishedAt: later, updatedAt: null },
    );
    expect((await ArticleRepo.findById(created.id))!.published_at).toEqual(at);

    // The flag is what the list surfaces read.
    expect(await ArticleRepo.countByStatus('org_status', 'published')).toBe(1);
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
    await ArticleRepo.recordPublication(created.id, entry, {
      publishedAt: at,
      updatedAt: null,
    });
    expect((await ArticleRepo.findById(created.id))!.publications[0]!.published_at).toEqual(at);

    const later = new Date('2026-07-31T12:00:00.000Z');
    await ArticleRepo.recordPublication(
      created.id,
      { ...entry, ref: 'sha2' },
      {
        updatedAt: later,
      },
    );
    const updated = (await ArticleRepo.findById(created.id))!.publications[0]!;
    expect(updated.updated_at).toEqual(later);
    expect(updated.published_at).toEqual(at);
  });

  test('recordPublication reconstructs an orphaned remote publish and later update', async () => {
    const firstPublishedAt = new Date('2026-08-01T10:00:00.000Z');
    const updatedAt = new Date('2026-08-02T10:00:00.000Z');
    const created = await ArticleRepo.create(
      base({ org_id: 'org_recovered', slug: 'recovered-static' }),
    );

    await ArticleRepo.recordPublication(
      created.id,
      {
        provider: 'static-site',
        ref: 'sha-recovered',
        slug: 'recovered-static',
      },
      { publishedAt: firstPublishedAt, updatedAt },
    );

    const recovered = (await ArticleRepo.findById(created.id))!;
    expect(recovered.publications[0]).toMatchObject({
      published_at: firstPublishedAt,
      updated_at: updatedAt,
    });
    expect(recovered.published_at).toEqual(firstPublishedAt);
  });

  test('recordPublication stores explicit insertion timestamps without equality inference', async () => {
    const publishedAt = new Date('2026-08-03T10:00:00.000Z');
    const updatedAt = new Date('2026-08-04T10:00:00.000Z');
    const updated = await ArticleRepo.create(
      base({ org_id: 'org_explicit_update', slug: 'explicit-update' }),
    );
    const unchanged = await ArticleRepo.create(
      base({ org_id: 'org_explicit_null', slug: 'explicit-null' }),
    );
    const equal = await ArticleRepo.create(
      base({ org_id: 'org_explicit_equal', slug: 'explicit-equal' }),
    );

    await ArticleRepo.recordPublication(
      updated.id,
      { provider: 'static-site', ref: 'sha-updated', slug: updated.slug },
      { publishedAt, updatedAt },
    );
    await ArticleRepo.recordPublication(
      unchanged.id,
      { provider: 'static-site', ref: 'sha-unchanged', slug: unchanged.slug },
      { publishedAt, updatedAt: null },
    );
    await ArticleRepo.recordPublication(
      equal.id,
      { provider: 'static-site', ref: 'sha-equal', slug: equal.slug },
      { publishedAt, updatedAt: publishedAt },
    );

    expect((await ArticleRepo.findById(updated.id))!.publications[0]).toMatchObject({
      published_at: publishedAt,
      updated_at: updatedAt,
    });
    expect((await ArticleRepo.findById(unchanged.id))!.publications[0]).toMatchObject({
      published_at: publishedAt,
      updated_at: null,
    });
    expect((await ArticleRepo.findById(equal.id))!.publications[0]).toMatchObject({
      published_at: publishedAt,
      updated_at: publishedAt,
    });
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

  test('auto-publish initialization is race-safe and one active lease wins', async () => {
    const created = await ArticleRepo.create(base({ org_id: 'org_claim', slug: 'claim' }));
    const requestedAt = new Date('2026-08-12T08:00:00.000Z');

    const initialized = await Promise.all(
      Array.from({ length: 8 }, () =>
        ArticleRepo.initializeAutoPublishAttempt(created.id, 'wordpress', requestedAt),
      ),
    );
    expect(initialized.filter(Boolean)).toHaveLength(1);
    expect((await ArticleRepo.findById(created.id))?.auto_publish.attempts).toHaveLength(1);

    const now = new Date('2026-08-12T08:01:00.000Z');
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        ArticleRepo.claimAutoPublishAttempt(created.id, 'wordpress', now, 300_000),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ status: 'publishing', attempt_count: 1 });
    expect(
      await ArticleRepo.claimAutoPublishAttempt(
        created.id,
        'wordpress',
        new Date('2026-08-12T08:02:00.000Z'),
        300_000,
      ),
    ).toBeNull();
  });

  test('expired claims are reclaimed and retry/failure/reset transitions stay provider-scoped', async () => {
    const created = await ArticleRepo.create(base({ org_id: 'org_retry', slug: 'retry' }));
    await ArticleRepo.initializeAutoPublishAttempt(created.id, 'wordpress');
    await ArticleRepo.initializeAutoPublishAttempt(created.id, 'static-site');

    const first = (await ArticleRepo.claimAutoPublishAttempt(
      created.id,
      'wordpress',
      new Date('2026-08-12T09:00:00.000Z'),
      60_000,
    ))!;
    const reclaimed = await ArticleRepo.claimAutoPublishAttempt(
      created.id,
      'wordpress',
      new Date('2026-08-12T09:02:00.000Z'),
      60_000,
    );
    expect(reclaimed).toMatchObject({ attempt_count: 2, status: 'publishing' });

    const transient = {
      code: 'network_error',
      kind: 'transient' as const,
      message: 'Provider could not be reached.',
      at: new Date(),
    };
    expect(
      await ArticleRepo.recordAutoPublishRetry(
        created.id,
        'wordpress',
        reclaimed!.lease_expires_at!,
        transient,
      ),
    ).toBe(true);
    const retryClaim = (await ArticleRepo.claimAutoPublishAttempt(
      created.id,
      'wordpress',
      new Date('2026-08-12T09:04:00.000Z'),
      60_000,
    ))!;
    const permanent = {
      code: 'wordpress_auth_failed',
      kind: 'permanent' as const,
      message: 'Reconnect WordPress.',
      at: new Date(),
    };
    expect(
      await ArticleRepo.failAutoPublishAttempt(
        created.id,
        'wordpress',
        permanent,
        retryClaim.lease_expires_at!,
      ),
    ).toBe(true);
    expect(await ArticleRepo.resetAutoPublishAttempt(created.id, 'wordpress')).toBe(true);

    const attempts = (await ArticleRepo.findById(created.id))!.auto_publish.attempts;
    expect(attempts.find((attempt) => attempt.provider === 'wordpress')).toMatchObject({
      status: 'queued',
      attempt_count: 0,
      last_error: null,
    });
    expect(attempts.find((attempt) => attempt.provider === 'static-site')).toMatchObject({
      status: 'queued',
      attempt_count: 0,
    });
    expect(first.requested_at).toBeInstanceOf(Date);
  });

  test('publication plus attempt completion reconciles without duplicate provider state', async () => {
    const created = await ArticleRepo.create(base({ org_id: 'org_reconcile', slug: 'repair' }));
    await ArticleRepo.initializeAutoPublishAttempt(created.id, 'static-site');
    await ArticleRepo.recordPublication(created.id, {
      provider: 'static-site',
      ref: 'abc123',
      slug: 'repair',
      remote_url: 'https://github.com/o/r/commit/abc123',
    });
    expect(await ArticleRepo.completeAutoPublishAttempt(created.id, 'static-site')).toBe(true);

    const reread = (await ArticleRepo.findById(created.id))!;
    expect(reread.publications).toHaveLength(1);
    expect(reread.publications[0]).toMatchObject({
      ref: 'abc123',
      remote_url: 'https://github.com/o/r/commit/abc123',
    });
    expect(reread.auto_publish.attempts).toEqual([
      expect.objectContaining({ provider: 'static-site', status: 'published', last_error: null }),
    ]);
    expect(
      await ArticleRepo.claimAutoPublishAttempt(created.id, 'static-site', new Date(), 60_000),
    ).toBeNull();
  });
});
