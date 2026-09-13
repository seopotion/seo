import type { ContentComplexity, SerpCompetitor } from '@shared/schemas';
import type { LinkCandidate } from './links';
import type { TopicBriefFields } from './topic';

export interface GenerationContext extends TopicBriefFields {
  businessName: string;
  businessDescription: string;
  language: string;
  country: string;
  audience: string;
  competitors: string[];
  articleStyle: string;
  includeCta: boolean;
  // Ceiling on internal links, never a quota (#186). The pre-#186 `internalLinks`
  // boolean collapsed the 0-3 preset to yes/no, which is why a preset of 1 shipped
  // 3-6 links.
  maxInternalLinks: number;
  // Link targets already proven live. Empty means the article ships with no
  // internal links, whatever `maxInternalLinks` says.
  linkCandidates: LinkCandidate[];
  llmInstructions: string;
  // Highest acceptable Flesch–Kincaid grade for English articles (#313). Comes
  // from presets.article_preferences.content_seo.readability_grade_max.
  readabilityGradeMax: number;
  // Selects the LLM ladder each stage runs on (design/ai-model-routing.md).
  // Comes from presets.article_preferences.content_seo.content_complexity.
  contentComplexity: ContentComplexity;
  keyword: string;
  articleType: string | null;
  intent: string | null;
  serpCompetitors: SerpCompetitor[];
}

export interface Outline {
  h1: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  sections: { heading: string; intent: string }[];
  faqs: { question: string; answer: string }[];
  // URLs chosen from `ctx.linkCandidates` — already filtered and capped by
  // `parseOutline`, so everything here is approved (#186). Replaces the
  // pre-#186 `internal_link_opportunities`, which were topics the model invented
  // for itself and then had to invent hrefs for.
  internal_links: string[];
  cta: string;
}

export interface GeneratedArticle {
  title: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  content: string;
  usage: { totalTokens: number; costUsd: number | null };
}

export interface ValidationFailure {
  code: string;
  message: string;
}
