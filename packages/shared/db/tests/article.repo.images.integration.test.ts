import type { ArticleImage, CreateArticleInput } from '@shared/schemas';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ArticleRepo } from '../src/repositories/article.repo';

const base: CreateArticleInput = {
  org_id: 'org_img',
  keyword_id: 'k1',
  title: 'T',
  meta_title: 'T meta',
  slug: 's',
  keyword: 'kw',
  meta_description: 'm',
  featured_image_url: '',
  content: '# T\n\nintro\n\n## A\n\nbody a\n\n## B\n\nbody b',
  difficulty: 10,
  search_volume: 20,
  status: 'generated',
  published_at: null,
};

const slot = (over: Partial<ArticleImage>): ArticleImage => ({
  role: 'inline',
  section_heading: 'A',
  prompt: 'p',
  alt: 'alt',
  url: '',
  model: null,
  seed: null,
  generated_at: null,
  width: null,
  height: null,
  ...over,
});

const plan: ArticleImage[] = [
  slot({ role: 'cover', section_heading: null }),
  slot({ section_heading: 'A' }),
  slot({ section_heading: 'B' }),
];

describe('ArticleRepo image slots (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('articles').deleteMany({ org_id: 'org_img' });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create defaults images to [] / pending', async () => {
    const a = await ArticleRepo.create(base);
    expect(a.images).toEqual([]);
    expect(a.images_status).toBe('pending');
  });

  test('setImagePlan is set-if-absent', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'plan' });
    expect(await ArticleRepo.setImagePlan(a.id, plan)).toBe(true);
    expect(await ArticleRepo.setImagePlan(a.id, plan)).toBe(false); // already planned
    const found = await ArticleRepo.findById(a.id);
    expect(found!.images).toHaveLength(3);
    expect(await ArticleRepo.setImagePlan('not-an-objectid', plan)).toBe(false);
  });

  test('fillImageSlot fills once and can swap content atomically', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'fill' });
    await ArticleRepo.setImagePlan(a.id, plan);
    const fill = {
      url: 'https://cdn/x.webp',
      model: 'm',
      seed: 7,
      generated_at: new Date(),
      width: 1200,
      height: 630,
    };

    expect(await ArticleRepo.fillImageSlot(a.id, 1, fill, 'NEW CONTENT')).toBe(true);
    let found = await ArticleRepo.findById(a.id);
    expect(found!.images[1]!.url).toBe('https://cdn/x.webp');
    expect(found!.images[1]!.width).toBe(1200);
    expect(found!.images[1]!.height).toBe(630);
    expect(found!.content).toBe('NEW CONTENT');

    // second fill of the same slot is a no-op (idempotent redelivery)
    expect(await ArticleRepo.fillImageSlot(a.id, 1, fill, 'CLOBBER')).toBe(false);
    found = await ArticleRepo.findById(a.id);
    expect(found!.content).toBe('NEW CONTENT');

    // cover fill with newContent = null leaves content alone
    expect(await ArticleRepo.fillImageSlot(a.id, 0, fill, null)).toBe(true);
    found = await ArticleRepo.findById(a.id);
    expect(found!.content).toBe('NEW CONTENT');
  });

  test('completeImages only fires when every slot is filled', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'complete' });
    await ArticleRepo.setImagePlan(a.id, plan);
    const fill = {
      url: 'https://cdn/c.webp',
      model: 'm',
      seed: null,
      generated_at: new Date(),
      width: 1200,
      height: 630,
    };

    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/c.webp')).toBe(false); // none filled
    await ArticleRepo.fillImageSlot(a.id, 0, fill, null);
    await ArticleRepo.fillImageSlot(a.id, 1, fill, null);
    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/c.webp')).toBe(false); // one empty
    await ArticleRepo.fillImageSlot(a.id, 2, fill, null);
    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/c.webp')).toBe(true);

    const found = await ArticleRepo.findById(a.id);
    expect(found!.images_status).toBe('complete');
    expect(found!.featured_image_url).toBe('https://cdn/c.webp');
  });

  test('failImages marks failed but never downgrades complete; complete recovers from failed', async () => {
    const a = await ArticleRepo.create({ ...base, slug: 'fail' });
    await ArticleRepo.setImagePlan(a.id, plan);
    await ArticleRepo.failImages(a.id);
    expect((await ArticleRepo.findById(a.id))!.images_status).toBe('failed');

    // a later successful pass can still complete from 'failed'
    const fill = {
      url: 'https://cdn/z.webp',
      model: 'm',
      seed: null,
      generated_at: new Date(),
      width: 1200,
      height: 630,
    };
    await ArticleRepo.fillImageSlot(a.id, 0, fill, null);
    await ArticleRepo.fillImageSlot(a.id, 1, fill, null);
    await ArticleRepo.fillImageSlot(a.id, 2, fill, null);
    expect(await ArticleRepo.completeImages(a.id, 'https://cdn/z.webp')).toBe(true);

    await ArticleRepo.failImages(a.id); // must NOT downgrade
    expect((await ArticleRepo.findById(a.id))!.images_status).toBe('complete');
  });
});
