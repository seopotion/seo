import { beforeEach, describe, expect, test, vi } from 'vitest';

const { findOrgById, listByOrg, replaceContent, closeDb } = vi.hoisted(() => ({
  findOrgById: vi.fn(),
  listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
  replaceContent: vi.fn(async () => true),
  closeDb: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { listByOrg, replaceContent },
  closeDb,
}));

const { verifyCandidates } = vi.hoisted(() => ({
  verifyCandidates: vi.fn(async (c: unknown[]) => c),
}));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
  verifyCandidates,
}));

import { cleanLinks } from '../src/lib/links';

const org = {
  id: 'o1',
  presets: {
    blog: { sitemap_url: '', main_blog_url: 'https://acme.com/blog', best_articles: [] },
    article_preferences: { content_seo: { internal_links_count: 1 } },
  },
};

const live = {
  id: 'a1',
  title: 'Widget Guide',
  slug: 'widget-guide',
  status: 'published',
  publications: [{ slug: 'widget-guide', published_at: new Date('2026-01-01') }],
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
      expect(res.data).toMatchObject({ scanned: 2, changed: 1, linksRemoved: 2, apply: false });
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
    const [, content] = replaceContent.mock.calls[0] as unknown as [string, string];
    expect(content).toBe('See features and this and guide.');
  });
});
