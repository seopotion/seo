import type { Keyword, Org } from '@shared/schemas';
import type { GenerationContext } from './types';

/** Derive the generation context from the org, its presets, and the keyword brief. */
export function buildContext(org: Org, keyword: Keyword): GenerationContext {
  const p = org.presets;
  if (!p) throw new Error('org has no presets');
  return {
    businessName: p.business.name,
    businessDescription: p.business.description,
    language: p.business.language,
    country: p.business.country,
    audience: p.audience.target.join(', '),
    competitors: p.audience.competitors,
    articleStyle: p.article_preferences.content_seo.article_style,
    internalLinks: p.article_preferences.content_seo.internal_links,
    llmInstructions: p.article_preferences.content_seo.llm_instructions,
    keyword: keyword.keyword,
    articleType: keyword.article_type ?? null,
    intent: keyword.intent ?? null,
    serpCompetitors: keyword.serp_competitors ?? [],
  };
}
