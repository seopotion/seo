import { beforeEach, describe, expect, test, vi } from 'vitest';

const { listByOrg, findById, resetImagesRepo, closeDb } = vi.hoisted(() => ({
  listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
  findById: vi.fn(),
  resetImagesRepo: vi.fn(async () => true),
  closeDb: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({
  ArticleRepo: { listByOrg, findById, resetImages: resetImagesRepo },
  closeDb,
}));

const { launchImageRepair } = vi.hoisted(() => ({
  launchImageRepair: vi.fn(async () => ({ run_id: 'run_1' })),
}));
vi.mock('@shared/articles', () => ({ launchImageRepair }));

import { planReset, resetImages, stripImageMarkdown } from '../src/lib/images';

const DEAD = 'detl6k0jbfi2q.cloudfront.net';
const LIVE = 'd1aklxjf6zd9yy.cloudfront.net';

const slot = (role: 'cover' | 'inline', url: string, heading: string | null = null) => ({
  role,
  section_heading: heading,
  prompt: 'p',
  alt: 'an alt',
  url,
  model: 'fal-ai/flux-2',
  seed: 7,
  generated_at: new Date('2026-01-01'),
  width: 1200,
  height: 630,
});

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  org_id: 'o1',
  title: 'Widget Guide',
  status: 'published',
  featured_image_url: `https://${DEAD}/articles/a1/cover.webp`,
  content:
    '## Intro\n\nBody.\n\n## Deep Dive\n\n![an alt](https://detl6k0jbfi2q.cloudfront.net/articles/a1/inline-1.webp)\n\nMore body.\n',
  images: [
    slot('cover', `https://${DEAD}/articles/a1/cover.webp`),
    slot('inline', `https://${DEAD}/articles/a1/inline-1.webp`, 'Deep Dive'),
  ],
  ...over,
});

describe('stripImageMarkdown', () => {
  test('removes the injected line and the blank line it came with', () => {
    const url = 'https://cdn/x.webp';
    const content = `## Heading\n\n![alt](${url})\n\nParagraph.\n`;
    expect(stripImageMarkdown(content, url)).toBe('## Heading\n\nParagraph.\n');
  });

  test('matches on url, not alt text (the editor may have changed it)', () => {
    const url = 'https://cdn/x.webp';
    expect(stripImageMarkdown(`## H\n\n![edited alt](${url})\n\nP.\n`, url)).toBe('## H\n\nP.\n');
  });

  test('leaves other images and regex-special urls alone', () => {
    const url = 'https://cdn/a+b(1).webp';
    const content = `![keep](https://cdn/other.webp)\n\n![drop](${url})\n`;
    expect(stripImageMarkdown(content, url)).toBe('![keep](https://cdn/other.webp)\n');
  });

  test('is a no-op when the line is already gone', () => {
    const content = '## H\n\nP.\n';
    expect(stripImageMarkdown(content, 'https://cdn/x.webp')).toBe(content);
  });
});

describe('planReset', () => {
  test('blanks dead slots, strips inline markdown, clears the cover', () => {
    const plan = planReset(article() as never, DEAD);
    expect(plan?.slots).toBe(2);
    expect(plan?.featuredImageUrl).toBe('');
    expect(plan?.images.every((i) => i.url === '')).toBe(true);
    expect(plan?.images.every((i) => i.generated_at === null && i.width === null)).toBe(true);
    // The plan (prompt/alt/heading) survives so the worker refills in place.
    expect(plan?.images[1]?.section_heading).toBe('Deep Dive');
    expect(plan?.content).not.toContain(DEAD);
    expect(plan?.content).toContain('## Deep Dive\n\nMore body.');
  });

  test('returns null when no url references the dead host', () => {
    const live = article({
      featured_image_url: `https://${LIVE}/c.webp`,
      content: '## Intro\n\nBody.\n',
      images: [slot('cover', `https://${LIVE}/c.webp`)],
    });
    expect(planReset(live as never, DEAD)).toBeNull();
  });

  test('ignores unfilled slots and unparseable urls', () => {
    const odd = article({
      featured_image_url: '',
      content: '## Intro\n\nBody.\n',
      images: [slot('cover', ''), slot('inline', 'not a url', 'Intro')],
    });
    expect(planReset(odd as never, DEAD)).toBeNull();
  });
});

describe('resetImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('requires a host', async () => {
    const res = await resetImages({ org: 'o1', apply: false, enqueue: false });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error.code).toBe('HOST_REQUIRED');
  });

  test('requires an org or an article', async () => {
    const res = await resetImages({ host: DEAD, apply: false, enqueue: false });
    expect(res.ok === false && res.error.code).toBe('TARGET_REQUIRED');
  });

  test('refuses --enqueue without --apply', async () => {
    const res = await resetImages({ host: DEAD, org: 'o1', apply: false, enqueue: true });
    expect(res.ok === false && res.error.code).toBe('ENQUEUE_NEEDS_APPLY');
  });

  test('dry run reports the targets and writes nothing', async () => {
    listByOrg.mockResolvedValueOnce({ articles: [article()], total: 1 });
    const res = await resetImages({ host: DEAD, org: 'o1', apply: false, enqueue: false });
    expect(res.ok && res.data.slotsReset).toBe(2);
    expect(res.ok && res.data.reset).toEqual([
      { id: 'a1', title: 'Widget Guide', status: 'published', slots: 2 },
    ]);
    expect(resetImagesRepo).not.toHaveBeenCalled();
  });

  test('--apply writes the blanked article and does not enqueue by default', async () => {
    listByOrg.mockResolvedValueOnce({ articles: [article()], total: 1 });
    const res = await resetImages({ host: DEAD, org: 'o1', apply: true, enqueue: false });
    expect(res.ok && res.data.enqueued).toBe(0);
    expect(resetImagesRepo).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ featuredImageUrl: '' }),
    );
    expect(launchImageRepair).not.toHaveBeenCalled();
  });

  test('--enqueue launches one image-repair run per reset article', async () => {
    listByOrg.mockResolvedValueOnce({ articles: [article()], total: 1 });
    const res = await resetImages({ host: DEAD, org: 'o1', apply: true, enqueue: true });
    expect(res.ok && res.data.enqueued).toBe(1);
    expect(launchImageRepair).toHaveBeenCalledTimes(1);
    expect(launchImageRepair).toHaveBeenCalledWith('o1', 'a1', { wait: true });
  });

  test('--enqueue surfaces a launch failure as RESET_IMAGES_FAILED', async () => {
    launchImageRepair.mockRejectedValueOnce(new Error('article not found in org'));
    listByOrg.mockResolvedValueOnce({ articles: [article()], total: 1 });
    const res = await resetImages({ host: DEAD, org: 'o1', apply: true, enqueue: true });
    expect(res.ok === false && res.error.code).toBe('RESET_IMAGES_FAILED');
  });

  test('--article targets one article', async () => {
    findById.mockResolvedValueOnce(article());
    const res = await resetImages({ host: DEAD, article: 'a1', apply: false, enqueue: false });
    expect(res.ok && res.data.scanned).toBe(1);
    expect(listByOrg).not.toHaveBeenCalled();
  });

  test('--article reports a missing id', async () => {
    findById.mockResolvedValueOnce(null);
    const res = await resetImages({ host: DEAD, article: 'nope', apply: false, enqueue: false });
    expect(res.ok === false && res.error.code).toBe('ARTICLE_NOT_FOUND');
  });
});
