export interface GenerationContext {
  businessName: string;
  businessDescription: string;
  language: string;
  country: string;
  audience: string;
  competitors: string[];
  articleStyle: string;
  internalLinks: boolean;
  llmInstructions: string;
  keyword: string;
  articleType: string | null;
  intent: string | null;
  serpCompetitors: string[];
}

export interface Outline {
  h1: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  sections: { heading: string; intent: string }[];
  faqs: { question: string; answer: string }[];
  internal_link_opportunities: string[];
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
