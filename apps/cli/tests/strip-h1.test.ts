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

import { stripH1 } from '../src/lib/strip-h1';

const org = { id: 'o1' };

const clean = {
  id: 'a1',
  title: 'Clean',
  status: 'generated',
  content: 'Intro.\n\n## A\n\nBody.\n',
};

const withH1 = {
  id: 'a2',
  title: 'Widget Guide',
  status: 'published',
  content: '# Widget Guide\n\nIntro.\n\n## A\n\nBody.\n',
};

describe('stripH1', () => {
  beforeEach(() => vi.clearAllMocks());

  test('requires --org', async () => {
    const res = await stripH1({ apply: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ORG_REQUIRED');
    expect(closeDb).not.toHaveBeenCalled();
  });

  test('fails when the org does not exist', async () => {
    findOrgById.mockResolvedValue(null);
    const res = await stripH1({ org: 'nope', apply: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ORG_NOT_FOUND');
    expect(closeDb).toHaveBeenCalled();
  });

  test('dry run counts articles that open with an H1 and writes nothing', async () => {
    findOrgById.mockResolvedValue(org);
    listByOrg.mockResolvedValueOnce({ articles: [clean, withH1], total: 2 });

    const res = await stripH1({ org: 'o1', apply: false });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({
        org: 'o1',
        apply: false,
        scanned: 2,
        changed: 1,
        publishedChanged: [{ id: 'a2', title: 'Widget Guide' }],
      });
    }
    expect(replaceContent).not.toHaveBeenCalled();
  });

  test('apply writes the body without its leading H1 and leaves clean articles alone', async () => {
    findOrgById.mockResolvedValue(org);
    listByOrg.mockResolvedValueOnce({ articles: [clean, withH1], total: 2 });

    const res = await stripH1({ org: 'o1', apply: true });

    expect(res.ok).toBe(true);
    expect(replaceContent).toHaveBeenCalledTimes(1);
    expect(replaceContent).toHaveBeenCalledWith('a2', 'Intro.\n\n## A\n\nBody.\n');
  });
});
