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
  });

  test('CreateArticleInput omits id and created_at', () => {
    expect('id' in CreateArticleInput.shape).toBe(false);
    expect('created_at' in CreateArticleInput.shape).toBe(false);
    expect('keyword_id' in CreateArticleInput.shape).toBe(true);
  });
});
