import { parseJsonObject } from '@shared/generation';
import type { LlmClient, LlmMessage } from '@shared/providers';
import { type SetupPresets, SetupPresetsSchema } from '@shared/schemas';
import { discoverBlog, fetchSite } from './scrape';

export interface ScanClients {
  llm: LlmClient;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Prompt for the LLM-owned preset fields. Competitors and blog URLs are handled
 * deterministically (manual entry / sitemap) and deliberately excluded here.
 */
function buildScanPrompt(url: string, pageText: string | null): LlmMessage[] {
  const system = [
    'You are an SEO onboarding assistant.',
    'From the scraped website content, produce onboarding presets as JSON.',
    'Respond with ONLY a JSON object of this exact shape:',
    '{ "business": { "name": string, "language": string, "country": string, "description": string },',
    '  "audience": { "target": string },',
    '  "article_preferences": {',
    '    "content_seo": { "article_style": string, "internal_links": boolean, "llm_instructions": string },',
    '    "engagement": { "image_style": string } } }',
    'Do NOT include competitors or blog URLs — those are handled separately.',
    'language is the primary content language (e.g. "English"); country is the primary target',
    'market as a plain country name (e.g. "United States") — never a region or "Global".',
    'description is 2-4 sentences summarizing the business.',
    'target describes the ideal audience. article_style / image_style are short phrases.',
  ].join('\n');

  const user = pageText
    ? `Website: ${url}\n\nScraped homepage content:\n${pageText}`
    : `Website: ${url}\n\n(The homepage could not be fetched. Infer reasonable presets from the domain name "${domainOf(url)}".)`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Real website scanner. Scrapes the homepage + sitemap and calls the LLM to
 * generate onboarding presets. Competitors are left empty for manual entry.
 * Always returns a valid SetupPresets on success; only unparseable/invalid LLM
 * output throws (the worker then re-throws → SQS retry → DLQ).
 * See design/product-flow.md §1.1.
 */
export async function scanWebsite(url: string, { llm }: ScanClients): Promise<SetupPresets> {
  const [page, blog] = await Promise.all([fetchSite(url), discoverBlog(url)]);

  const res = await llm.complete({
    messages: buildScanPrompt(url, page?.text ?? null),
    responseFormat: 'json',
  });

  const fields = parseJsonObject(res.text) as {
    business?: unknown;
    audience?: { target?: unknown };
    article_preferences?: unknown;
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
