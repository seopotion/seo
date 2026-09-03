import { describe, expect, test } from 'vitest';
import { ArticleSchema, SetupPresetsSchema } from '../src';

const baseArticleDoc = {
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

const basePresetsDoc = {
  business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
  audience: { target: ['makers'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: 'x', internal_links_count: 0, llm_instructions: '' },
    engagement: { image_direction: { medium: 'photograph', palette: '', notes: '' } },
  },
};

describe('Article.video (#85)', () => {
  test('pre-#85 docs (no video key) parse with video null', () => {
    expect(ArticleSchema.parse(baseArticleDoc).video).toBeNull();
  });

  test('a stored video round-trips', () => {
    const video = { video_id: 'dQw4w9WgXcQ', title: 'Widget basics', section_heading: 'Intro' };
    expect(ArticleSchema.parse({ ...baseArticleDoc, video }).video).toEqual(video);
  });
});

describe('presets youtube_videos (#73)', () => {
  test('defaults to true when omitted', () => {
    const p = SetupPresetsSchema.parse(basePresetsDoc);
    expect(p.article_preferences.engagement.youtube_videos).toBe(true);
  });

  test('an explicit false is preserved', () => {
    const doc = {
      ...basePresetsDoc,
      article_preferences: {
        ...basePresetsDoc.article_preferences,
        engagement: {
          image_direction: { medium: 'photograph', palette: '', notes: '' },
          youtube_videos: false,
        },
      },
    };
    const p = SetupPresetsSchema.parse(doc);
    expect(p.article_preferences.engagement.youtube_videos).toBe(false);
  });
});
