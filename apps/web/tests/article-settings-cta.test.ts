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
  readabilityGradeMax: '8',
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
            readability_grade_max: 8,
          },
          engagement: {
            image_direction: { medium: 'photograph', palette: '', notes: '' },
            include_cta: false,
            youtube_videos: false,
          },
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

describe('article settings readability target (#313)', () => {
  const response = {
    article_preferences: {
      content_seo: {
        article_style: 'Informative',
        internal_links_count: 1,
        table_of_contents: true,
        llm_instructions: '',
        readability_grade_max: 12,
      },
      engagement: {
        image_direction: { medium: 'photograph', palette: '', notes: '' },
        include_cta: true,
        youtube_videos: true,
      },
      publishing: { auto_publish: false },
    },
  };

  test('hydrates the tier from the API response as a string', () => {
    expect(mergeArticleSettings(response, settings).readabilityGradeMax).toBe('12');
  });

  test('sends the tier back as a number alongside the other content_seo fields', () => {
    expect(
      buildArticleSettingsPatch({ ...settings, readabilityGradeMax: '10' }).content_seo,
    ).toEqual({
      article_style: 'Practical',
      internal_links_count: 2,
      table_of_contents: true,
      readability_grade_max: 10,
    });
  });
});
