import { describe, expect, test } from 'vitest';
import {
  buildArticleSettingsPatch,
  mergeArticleSettings,
} from '../app/[locale]/(authenticated)/(product)/article-settings/article-settings';

const settings = {
  articleStyle: 'Practical',
  autoPublish: false,
  includeCta: true,
  internalLinksCount: '2',
  tableOfContents: true,
  youtubeVideos: true,
};

describe('article settings CTA preference', () => {
  test('hydrates a disabled CTA preference from the API response', () => {
    const merged = mergeArticleSettings(
      {
        article_preferences: {
          content_seo: {
            article_style: 'Informative',
            internal_links_count: 1,
            table_of_contents: false,
            llm_instructions: '',
          },
          engagement: { image_style: 'Sketch', include_cta: false, youtube_videos: false },
          publishing: { auto_publish: false },
        },
      },
      settings,
    );

    expect(merged.includeCta).toBe(false);
  });

  test('sends the CTA preference without dropping engagement siblings', () => {
    expect(buildArticleSettingsPatch({ ...settings, includeCta: false }).engagement).toEqual({
      include_cta: false,
      youtube_videos: true,
    });
  });
});
