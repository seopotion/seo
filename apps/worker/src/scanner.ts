import type { SetupPresets } from '@shared/schemas';

export async function scanWebsite(_websiteUrl: string): Promise<SetupPresets> {
  return {
    business: {
      name: '',
      language: '',
      country: '',
      description: '',
    },
    audience: {
      target: '',
      competitors: [],
    },
    blog: {
      sitemap_url: '',
      main_blog_url: '',
      best_articles: [],
    },
    article_preferences: {
      content_seo: {
        article_style: '',
        internal_links: true,
        llm_instructions: '',
      },
      engagement: {
        image_style: '',
      },
    },
  };
}
