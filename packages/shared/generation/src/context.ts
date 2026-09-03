import type { Keyword, Org } from '@shared/schemas';
import type { LinkCandidate } from './links';
import type { GenerationContext } from './types';

/** Derive the generation context from the org, its presets, and the keyword brief.
 * `linkCandidates` are the verified internal-link targets the caller resolved
 * (#186); an empty list means this article gets no internal links. */
export function buildContext(
  org: Pick<Org, 'presets'>,
  keyword: Keyword,
  linkCandidates: LinkCandidate[] = [],
): GenerationContext {
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
    includeCta: p.article_preferences.engagement.include_cta,
    maxInternalLinks: p.article_preferences.content_seo.internal_links_count,
    linkCandidates,
    llmInstructions: p.article_preferences.content_seo.llm_instructions,
    readabilityGradeMax: p.article_preferences.content_seo.readability_grade_max,
    keyword: keyword.keyword,
    topic_cluster_id: keyword.topic_cluster_id,
    topic_cluster_label: keyword.topic_cluster_label,
    topic_role: keyword.topic_role,
    topic_content_focus: keyword.topic_content_focus,
    topic_primary_keyword: keyword.topic_primary_keyword,
    articleType: keyword.article_type ?? null,
    intent: keyword.intent ?? null,
    serpCompetitors: keyword.serp_competitors ?? [],
  };
}
