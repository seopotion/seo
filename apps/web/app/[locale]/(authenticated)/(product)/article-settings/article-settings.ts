import { articleStyles } from '../../onboarding/constants';

export type ArticleSettingsForm = {
  autoPublish: boolean;
  articleStyle: string;
  includeCta: boolean;
  internalLinksCount: string;
  readabilityGradeMax: string;
  tableOfContents: boolean;
  youtubeVideos: boolean;
};

export type ArticleSettingsResponse = {
  article_preferences: {
    content_seo: {
      article_style: string;
      internal_links_count: number;
      table_of_contents: boolean;
      llm_instructions: string;
      readability_grade_max: number;
    };
    engagement: {
      image_style: string;
      include_cta: boolean;
      youtube_videos: boolean;
    };
    publishing: {
      auto_publish: boolean;
    };
  };
};

export const initialArticleSettings: ArticleSettingsForm = {
  articleStyle: articleStyles[1].value,
  autoPublish: false,
  includeCta: true,
  internalLinksCount: '1',
  readabilityGradeMax: '8',
  tableOfContents: true,
  youtubeVideos: true,
};

export function mergeArticleSettings(
  data: ArticleSettingsResponse,
  currentSettings: ArticleSettingsForm,
): ArticleSettingsForm {
  return {
    ...currentSettings,
    articleStyle: data.article_preferences.content_seo.article_style,
    includeCta: data.article_preferences.engagement.include_cta,
    internalLinksCount: String(data.article_preferences.content_seo.internal_links_count),
    readabilityGradeMax: String(data.article_preferences.content_seo.readability_grade_max),
    tableOfContents: data.article_preferences.content_seo.table_of_contents,
    youtubeVideos: data.article_preferences.engagement.youtube_videos,
    autoPublish: data.article_preferences.publishing.auto_publish,
  };
}

export function buildArticleSettingsPatch(settings: ArticleSettingsForm) {
  return {
    content_seo: {
      article_style: settings.articleStyle,
      internal_links_count: Number.parseInt(settings.internalLinksCount, 10),
      table_of_contents: settings.tableOfContents,
      readability_grade_max: Number.parseInt(settings.readabilityGradeMax, 10),
    },
    engagement: {
      include_cta: settings.includeCta,
      youtube_videos: settings.youtubeVideos,
    },
    publishing: {
      auto_publish: settings.autoPublish,
    },
  };
}
