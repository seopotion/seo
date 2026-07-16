import { parseJsonObject } from '@shared/generation';
import type { LlmClient, LlmMessage } from '@shared/providers';
import { type SetupPresets, SetupPresetsSchema } from '@shared/schemas';
import { discoverBlog, fetchSite } from './scrape';

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

  // SetupPresetsSchema is the single validation gate — a malformed/incomplete
  // LLM object throws here and dead-letters rather than persisting junk.
  return SetupPresetsSchema.parse({
    business: fields.business,
    audience: { target: fields.audience?.target, competitors: [] },
    blog,
    article_preferences: fields.article_preferences,
  });
}
