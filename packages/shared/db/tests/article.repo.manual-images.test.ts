import { ArticleSchema } from '@shared/schemas';
import { ObjectId } from 'mongodb';
import { beforeEach, expect, test, vi } from 'vitest';

const { findOneAndUpdate } = vi.hoisted(() => ({ findOneAndUpdate: vi.fn() }));
vi.mock('../src/client', () => ({
  getDb: async () => ({ collection: () => ({ findOneAndUpdate }) }),
}));

import { ArticleRepo } from '../src/repositories/article.repo';

const article = ArticleSchema.parse({
  id: 'b'.repeat(24),
  org_id: 'org',
  keyword_id: null,
  keyword: null,
  title: 'Guide',
  slug: 'guide',
  meta_title: 'Guide',
  meta_description: 'Guide',
  content: '## First',
  featured_image_url: '',
  difficulty: null,
  search_volume: null,
  status: 'generated',
  created_at: new Date(),
  published_at: null,
  images_status: 'complete',
});
const cover = {
  role: 'cover' as const,
  section_heading: null,
  alt: 'A lake',
  url: 'https://cdn.example.com/cover.png',
  prompt: '',
  model: null,
  seed: null,
  generated_at: null,
  width: 1,
  height: 1,
};
beforeEach(() => vi.clearAllMocks());

test('atomically persists image metadata and cover URL, guarding the article snapshot and ownership', async () => {
  const { id, ...document } = article;
  findOneAndUpdate.mockResolvedValue({
    ...document,
    _id: new ObjectId(id),
    images: [cover],
    featured_image_url: cover.url,
  });
  const result = await ArticleRepo.saveManualImage(article, [cover], article.content, cover.url);
  expect(result?.images).toEqual([cover]);
  expect(findOneAndUpdate).toHaveBeenCalledWith(
    {
      _id: new ObjectId(id),
      org_id: article.org_id,
      keyword_id: null,
      status: { $ne: 'deleted' },
      content: article.content,
      images: [],
      updated_at: null,
    },
    {
      $set: {
        images: [cover],
        content: article.content,
        featured_image_url: cover.url,
        images_status: 'complete',
        updated_at: expect.any(Date),
      },
    },
    { returnDocument: 'after' },
  );
});

test('returns a conflict without a fallback write when the article snapshot changed', async () => {
  findOneAndUpdate.mockResolvedValue(null);
  expect(await ArticleRepo.saveManualImage(article, [cover], 'new content', cover.url)).toBeNull();
  expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
});

test('atomically removes the last image and keeps the article ready for publishing', async () => {
  const before = { ...article, images: [cover], featured_image_url: cover.url };
  const { id, ...document } = article;
  findOneAndUpdate.mockResolvedValue({ ...document, _id: new ObjectId(id) });
  const result = await ArticleRepo.saveManualImage(before, [], article.content, '');
  expect(result?.images).toEqual([]);
  expect(result?.featured_image_url).toBe('');
  expect(result?.images_status).toBe('complete');
  expect(findOneAndUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      images: [cover],
      content: before.content,
      updated_at: before.updated_at,
    }),
    {
      $set: {
        images: [],
        content: article.content,
        featured_image_url: '',
        images_status: 'complete',
        updated_at: expect.any(Date),
      },
    },
    { returnDocument: 'after' },
  );
});

test('refuses generated articles and image arrays exceeding the slot limits', async () => {
  expect(
    await ArticleRepo.saveManualImage(
      { ...article, keyword_id: 'planner' },
      [cover],
      '',
      cover.url,
    ),
  ).toBeNull();
  expect(await ArticleRepo.saveManualImage(article, [cover, cover], '', cover.url)).toBeNull();
  const inline = { ...cover, role: 'inline' as const, section_heading: 'First' };
  expect(
    await ArticleRepo.saveManualImage(
      article,
      Array.from({ length: 9 }, () => inline),
      '',
      '',
    ),
  ).toBeNull();
  expect(findOneAndUpdate).not.toHaveBeenCalled();
});

test('persists eight manual images including an optional cover', async () => {
  const inline = { ...cover, role: 'inline' as const, section_heading: 'First' };
  const images = [cover, ...Array.from({ length: 7 }, () => inline)];
  const { id, ...document } = article;
  findOneAndUpdate.mockResolvedValue({ ...document, _id: new ObjectId(id), images });
  expect(
    (await ArticleRepo.saveManualImage(article, images, article.content, cover.url))?.images,
  ).toHaveLength(8);
});
