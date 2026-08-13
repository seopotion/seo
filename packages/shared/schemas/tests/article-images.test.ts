import { describe, expect, test } from 'vitest';
import { ArticleSchema, ImageTask, PublishTask } from '../src';

const baseDoc = {
  id: 'a1',
  org_id: 'o1',
  keyword_id: 'k1',
  title: 't',
  meta_title: 'mt',
  slug: 's',
  keyword: 'kw',
  meta_description: 'md',
  featured_image_url: '',
  content: '# c',
  difficulty: 1,
  search_volume: 2,
  status: 'generated',
  created_at: new Date(),
  published_at: null,
};

describe('article image fields (#51)', () => {
  test('pre-#51 documents parse with image defaults', () => {
    const a = ArticleSchema.parse(baseDoc);
    expect(a.images).toEqual([]);
    expect(a.images_status).toBe('pending');
  });

  test('image slots round-trip', () => {
    const a = ArticleSchema.parse({
      ...baseDoc,
      images: [
        {
          role: 'cover',
          section_heading: null,
          prompt: 'p',
          alt: 'alt',
          url: '',
          model: null,
          seed: null,
          generated_at: null,
        },
      ],
      images_status: 'pending',
    });
    expect(a.images[0]!.role).toBe('cover');
    expect(a.images[0]!.url).toBe('');
  });

  test('rejects an unknown images_status', () => {
    expect(() => ArticleSchema.parse({ ...baseDoc, images_status: 'nope' })).toThrow();
  });
});

describe('ImageTask', () => {
  test('validates the queue contract', () => {
    expect(ImageTask.parse({ org_id: 'o', article_id: 'a' })).toEqual({
      org_id: 'o',
      article_id: 'a',
    });
    expect(() => ImageTask.parse({ org_id: 'o' })).toThrow();
  });
});

describe('PublishTask', () => {
  test.each(['wordpress', 'static-site'] as const)('validates the %s provider', (provider) => {
    expect(PublishTask.parse({ org_id: 'o', article_id: 'a', provider })).toEqual({
      org_id: 'o',
      article_id: 'a',
      provider,
    });
  });

  test('rejects unsupported providers', () => {
    expect(() => PublishTask.parse({ org_id: 'o', article_id: 'a', provider: 'ghost' })).toThrow();
  });
});
