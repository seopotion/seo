import { beforeEach, describe, expect, test, vi } from 'vitest';

const { findOrgById, listByOrg, replaceContent, closeDb, listIntegrations, setStaticSitePostBase } =
  vi.hoisted(() => ({
    findOrgById: vi.fn(),
    listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
    replaceContent: vi.fn(async () => true),
    closeDb: vi.fn(async () => {}),
    listIntegrations: vi.fn(async () => [
      { provider: 'static-site', post_url_base: 'https://acme.com/blog' as string | null },
    ]),
    setStaticSitePostBase: vi.fn(async () => true),
  }));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { listByOrg, replaceContent },
  IntegrationRepo: { listByOrgId: listIntegrations, setStaticSitePostBase },
  closeDb,
}));

const { verifyCandidates } = vi.hoisted(() => ({
  verifyCandidates: vi.fn(async (c: unknown[]) => c),
}));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
  verifyCandidates,
}));

import { cleanLinks, setPostBase } from '../src/lib/links';

// main_blog_url is empty on purpose: candidate URLs come from the static-site
// integration's post_url_base (#228), not from presets.
const org = {
  id: 'o1',
  presets: {
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: { content_seo: { internal_links_count: 1 } },
  },
};

const live = {
  id: 'a1',
  title: 'Widget Guide',
  slug: 'widget-guide',
  status: 'published',
  publications: [
    {
      provider: 'static-site',
      slug: 'widget-guide',
      published_at: new Date('2026-01-01'),
      remote_url: 'https://github.com/acme/site/commit/abc',
    },
  ],
  content: 'A clean article with no links.',
};

const dirty = {
  id: 'a2',
  title: 'Dirty',
  slug: 'dirty',
  status: 'generated',
  publications: [],
  content:
    'See [features](/features/invented) and [this](#) and [guide](https://acme.com/blog/widget-guide).',
};

describe('cleanLinks', () => {
  beforeEach(() => vi.clearAllMocks());

  test('requires an org id', async () => {
    const res = await cleanLinks({ apply: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ORG_REQUIRED');
  });

  test('fails when the org does not exist', async () => {
    findOrgById.mockResolvedValue(null);
    const res = await cleanLinks({ org: 'nope', apply: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ORG_NOT_FOUND');
  });

  test('dry run reports what would change and writes nothing', async () => {
    findOrgById.mockResolvedValue(org);
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 }) // published candidates
      .mockResolvedValueOnce({ articles: [live, dirty], total: 2 }); // all articles

    const res = await cleanLinks({ org: 'o1', apply: false });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({
        scanned: 2,
        changed: 1,
        linksRemoved: 2,
        apply: false,
        allowedUrls: 1,
        published: 1,
      });
    }
    expect(replaceContent).not.toHaveBeenCalled();
  });

  test('apply writes the sanitized content and keeps the live link', async () => {
    findOrgById.mockResolvedValue(org);
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 })
      .mockResolvedValueOnce({ articles: [dirty], total: 1 });

    const res = await cleanLinks({ org: 'o1', apply: true });

    expect(res.ok).toBe(true);
    expect(replaceContent).toHaveBeenCalledTimes(1);
    const [id, content] = replaceContent.mock.calls[0] as unknown as [string, string];
    expect(id).toBe('a2');
    expect(content).toBe('See features and this and [guide](https://acme.com/blog/widget-guide).');
  });

  test('lists published articles that changed, so they can be republished', async () => {
    findOrgById.mockResolvedValue(org);
    const dirtyPublished = { ...dirty, id: 'a3', title: 'Live One', status: 'published' };
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 })
      .mockResolvedValueOnce({ articles: [dirtyPublished], total: 1 });

    const res = await cleanLinks({ org: 'o1', apply: true });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.publishedChanged).toEqual([{ id: 'a3', title: 'Live One' }]);
  });

  test('with no verified candidates every link is removed', async () => {
    findOrgById.mockResolvedValue(org);
    verifyCandidates.mockResolvedValueOnce([]);
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 })
      .mockResolvedValueOnce({ articles: [dirty], total: 1 });

    const res = await cleanLinks({ org: 'o1', apply: true });

    expect(res.ok).toBe(true);
    // `published` next to `allowedUrls: 0` is what makes "org published N
    // articles yet none verified" visible to an operator (#228).
    if (res.ok) expect(res.data).toMatchObject({ allowedUrls: 0, published: 1 });
    const [, content] = replaceContent.mock.calls[0] as unknown as [string, string];
    expect(content).toBe('See features and this and guide.');
  });

  test('a static-site org without a post base yields zero allowed URLs, not a guess', async () => {
    findOrgById.mockResolvedValue(org);
    listIntegrations.mockResolvedValueOnce([{ provider: 'static-site', post_url_base: null }]);
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 })
      .mockResolvedValueOnce({ articles: [dirty], total: 1 });

    const res = await cleanLinks({ org: 'o1', apply: false });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ allowedUrls: 0, published: 1 });
  });
});

describe('setPostBase', () => {
  beforeEach(() => vi.clearAllMocks());

  test('requires an org id', async () => {
    const res = await setPostBase({ base: 'https://acme.com' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ORG_REQUIRED');
  });

  test('rejects a base a post URL cannot be built from', async () => {
    for (const base of [undefined, 'not a url', 'ftp://a.com', 'https://a.com?page=2']) {
      const res = await setPostBase({ org: 'o1', base });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('INVALID_BASE');
    }
    expect(setStaticSitePostBase).not.toHaveBeenCalled();
  });

  test('stores the base on the static-site connection', async () => {
    const res = await setPostBase({ org: 'o1', base: 'https://www.clewas.com' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ org: 'o1', postUrlBase: 'https://www.clewas.com' });
    expect(setStaticSitePostBase).toHaveBeenCalledWith('o1', 'https://www.clewas.com');
  });

  test('fails when the org has no static-site connection', async () => {
    setStaticSitePostBase.mockResolvedValueOnce(false);
    const res = await setPostBase({ org: 'o1', base: 'https://acme.com' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NO_STATIC_SITE');
  });
});
