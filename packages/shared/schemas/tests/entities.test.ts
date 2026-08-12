import { describe, expect, test } from 'vitest';
import { ArticleSchema, CreateArticleInput, CreateKeywordInput, KeywordSchema } from '../src';

describe('KeywordSchema', () => {
  test('parses a full keyword and accepts null article_id', () => {
    const k = KeywordSchema.parse({
      id: 'k1',
      org_id: 'o1',
      keyword: 'notion seo',
      status: 'scheduled',
      scheduled_date: '2026-07-02',
      search_volume: 170,
      difficulty: 36,
      article_id: null,
      created_at: new Date(),
    });
    expect(k.article_id).toBeNull();
  });

  test('CreateKeywordInput omits id and created_at', () => {
    expect('id' in CreateKeywordInput.shape).toBe(false);
    expect('created_at' in CreateKeywordInput.shape).toBe(false);
    expect('org_id' in CreateKeywordInput.shape).toBe(true);
  });
});

describe('ArticleSchema', () => {
  test('parses a full article with a nullable published_at', () => {
    const a = ArticleSchema.parse({
      id: 'a1',
      org_id: 'o1',
      keyword_id: 'k1',
      title: 'Best Practices',
      meta_title: 'Best Practices 2026',
      slug: 'best-practices',
      keyword: 'notion seo',
      meta_description: 'meta',
      featured_image_url: 'https://x/i.png',
      content: '# body',
      difficulty: 36,
      search_volume: 170,
      status: 'generated',
      created_at: new Date(),
      published_at: null,
    });
    expect(a.status).toBe('generated');
    expect(a.published_at).toBeNull();
    expect(a.wordpress_post_id).toBeUndefined();
    expect(a.topic_cluster_id).toBeNull();
    expect(a.topic_cluster_label).toBeNull();
    expect(a.topic_role).toBeNull();
    expect(a.topic_content_focus).toBeNull();
    expect(a.topic_primary_keyword).toBeNull();
  });

  test.each(['pillar', 'support'] as const)('round-trips explicit %s topic metadata', (role) => {
    const a = ArticleSchema.parse({
      id: 'a1',
      org_id: 'o1',
      keyword_id: 'k1',
      title: 'Membrane Fouling',
      meta_title: 'Membrane Fouling Guide',
      slug: 'membrane-fouling',
      keyword: 'membrane fouling',
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: role,
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: 'membrane fouling',
      meta_description: 'meta',
      featured_image_url: '',
      content: '# body',
      difficulty: 36,
      search_volume: 170,
      status: 'generated',
      created_at: new Date(),
      published_at: null,
    });

    expect(a).toMatchObject({
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: role,
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: 'membrane fouling',
    });
  });

  test('accepts only a positive integer WordPress post ID', () => {
    const base = {
      id: 'a1',
      org_id: 'o1',
      keyword_id: 'k1',
      title: 'Best Practices',
      meta_title: 'Best Practices 2026',
      slug: 'best-practices',
      keyword: 'notion seo',
      meta_description: 'meta',
      featured_image_url: 'https://x/i.png',
      content: '# body',
      difficulty: 36,
      search_volume: 170,
      status: 'generated' as const,
      created_at: new Date(),
      published_at: null,
    };

    expect(ArticleSchema.parse({ ...base, wordpress_post_id: 42 }).wordpress_post_id).toBe(42);
    expect(() => ArticleSchema.parse({ ...base, wordpress_post_id: 0 })).toThrow();
    expect(() => ArticleSchema.parse({ ...base, wordpress_post_id: 1.5 })).toThrow();
  });

  test('CreateArticleInput omits server-owned fields', () => {
    expect('id' in CreateArticleInput.shape).toBe(false);
    expect('created_at' in CreateArticleInput.shape).toBe(false);
    expect('wordpress_post_id' in CreateArticleInput.shape).toBe(false);
    expect('keyword_id' in CreateArticleInput.shape).toBe(true);
  });

  test('CreateArticleInput defaults omitted topic metadata to null', () => {
    const parsed = CreateArticleInput.parse({
      org_id: 'o1',
      keyword_id: 'k1',
      title: 'Best Practices',
      meta_title: 'Best Practices 2026',
      slug: 'best-practices',
      keyword: 'notion seo',
      meta_description: 'meta',
      featured_image_url: '',
      content: '# body',
      difficulty: 36,
      search_volume: 170,
      status: 'generated',
      published_at: null,
    });

    expect(parsed).toMatchObject({
      topic_cluster_id: null,
      topic_cluster_label: null,
      topic_role: null,
      topic_content_focus: null,
      topic_primary_keyword: null,
    });
  });
});
