import type { SetupPresets } from '@shared/schemas';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'example.com';
  }
}

function brandOf(host: string): string {
  const label = host.split('.')[0] || 'example';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Website scanner — MOCK implementation. Generates deterministic placeholder
 * presets derived from the URL so the onboarding flow is exercisable end-to-end
 * without scraping or AI. Replace with real scrape + LLM calls later.
 * See design/product-flow.md §1.1.
 */
export async function scanWebsite(websiteUrl: string): Promise<SetupPresets> {
  const host = hostOf(websiteUrl);
  const brand = brandOf(host);

  return {
    business: {
      name: brand,
      language: 'English',
      country: 'Global (English)',
      description: `${brand} provides products and services via ${host}. (mock description — replace with AI-generated copy)`,
    },
    audience: {
      target: `People searching for solutions related to ${brand}.`,
      competitors: ['competitor-a.com', 'competitor-b.com'],
    },
    blog: {
      sitemap_url: `https://${host}/sitemap.xml`,
      main_blog_url: `https://${host}/blog`,
      best_articles: [`https://${host}/blog/getting-started`, `https://${host}/blog/how-it-works`],
    },
    article_preferences: {
      content_seo: {
        article_style: 'Informative, practical, SEO-optimized',
        internal_links: true,
        llm_instructions: `Write in a clear, helpful tone for ${brand}'s audience.`,
      },
      engagement: {
        image_style: 'Clean, modern, minimal',
      },
    },
  };
}
