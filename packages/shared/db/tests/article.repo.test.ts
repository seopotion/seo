import type { CreateArticleInput } from '@shared/schemas';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { find, insertOne, limit, sort, toArray } = vi.hoisted(() => ({
  find: vi.fn(),
  insertOne: vi.fn(),
  limit: vi.fn(),
  sort: vi.fn(),
  toArray: vi.fn(),
}));

vi.mock('../src/client', () => ({
  getDb: async () => ({ collection: () => ({ find, insertOne }) }),
}));

import { ArticleRepo } from '../src/repositories/article.repo';

const base = (over: Partial<CreateArticleInput> = {}): CreateArticleInput => ({
  org_id: 'org-topic',
  keyword_id: 'keyword-1',
  title: 'Membrane Fouling',
  meta_title: 'Membrane Fouling Guide',
  slug: 'membrane-fouling',
  keyword: 'membrane fouling',
  meta_description: 'A guide to membrane fouling',
  featured_image_url: '',
  content: '# Membrane Fouling',
  difficulty: 20,
  search_volume: 100,
  status: 'generated',
  published_at: null,
  ...over,
});

describe('ArticleRepo topic metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const insertedId = new ObjectId('64b000000000000000000001');
    insertOne.mockResolvedValue({ insertedId });
    find.mockReturnValue({ sort });
    sort.mockReturnValue({ limit });
    limit.mockReturnValue({ toArray });
  });

  test('create validates, stores, and returns explicit topic metadata', async () => {
    const input = base({
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: 'pillar',
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: 'membrane fouling',
    });

    const article = await ArticleRepo.create(input);

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        topic_cluster_id: 'topic:membrane fouling',
        topic_cluster_label: 'Membrane fouling',
        topic_role: 'pillar',
        topic_content_focus: 'What membrane fouling is and why it occurs',
        topic_primary_keyword: 'membrane fouling',
      }),
    );
    expect(article).toMatchObject({
      id: '64b000000000000000000001',
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: 'pillar',
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: 'membrane fouling',
    });
  });

  test('create defaults legacy/manual topic metadata to null', async () => {
    const article = await ArticleRepo.create(base());
    expect(article).toMatchObject({
      topic_cluster_id: null,
      topic_cluster_label: null,
      topic_role: null,
      topic_content_focus: null,
      topic_primary_keyword: null,
    });
  });

  test('same-cluster lookup is org-scoped, published-only, ordered, and bounded', async () => {
    toArray.mockResolvedValue([]);

    await ArticleRepo.listPublishedByTopicCluster('org-topic', 'topic:membrane fouling', {
      limit: 25,
      role: { value: 'pillar', mode: 'include' },
    });

    expect(find).toHaveBeenCalledWith({
      org_id: 'org-topic',
      status: 'published',
      topic_cluster_id: 'topic:membrane fouling',
      topic_role: 'pillar',
    });
    expect(sort).toHaveBeenCalledWith({ created_at: -1 });
    expect(limit).toHaveBeenCalledWith(25);
  });

  test('same-cluster lookup can exclude the complementary role for the second tier', async () => {
    toArray.mockResolvedValue([]);

    await ArticleRepo.listPublishedByTopicCluster('org-topic', 'topic:membrane fouling', {
      limit: 25,
      role: { value: 'pillar', mode: 'exclude' },
    });

    expect(find).toHaveBeenCalledWith({
      org_id: 'org-topic',
      status: 'published',
      topic_cluster_id: 'topic:membrane fouling',
      topic_role: { $ne: 'pillar' },
    });
  });
});
