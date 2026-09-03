import { parseJsonObject } from '@shared/generation';
import type { LlmClient, LlmMessage } from '@shared/providers';
import {
  AUDIENCE_TARGET_MAX,
  ImageDirectionSchema,
  type SetupPresets,
  SetupPresetsSchema,
  toStrictJsonSchema,
} from '@shared/schemas';
import { z } from 'zod';
import { discoverBlog, fetchSite } from './scrape';

export interface ScanClients {
  llm: LlmClient;
}

/**
 * The LLM-owned slice of the presets — deliberately narrower than
 * SetupPresetsSchema, which also covers fields the scanner fills in itself
 * (competitors, blog URLs) or defaults. This is both the wire schema the model
 * is constrained to and the parse target for its reply.
 */
const ScanOutputSchema = z.object({
  business: SetupPresetsSchema.shape.business,
  audience: z.object({ target: z.array(z.string()) }),
  article_preferences: z.object({
    content_seo: z.object({ article_style: z.string(), llm_instructions: z.string() }),
    engagement: z.object({ image_direction: ImageDirectionSchema }),
  }),
});

const SCAN_RESPONSE_SCHEMA = toStrictJsonSchema(ScanOutputSchema, 'setup_presets');

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
  // The response shape is enforced by SCAN_RESPONSE_SCHEMA, so this describes
  // only what the schema cannot: what each field should MEAN.
  const system = [
    'You are an SEO onboarding assistant.',
    'From the scraped website content, produce onboarding presets as JSON.',
    'language is the primary content language (e.g. "English"); country is the primary target',
    'market as a plain country name (e.g. "United States") — never a region or "Global".',
    'description is 2-4 sentences summarizing the business.',
    'target is an array of 3-7 short, distinct audience segments (one segment per entry —',
    'never a single comma-separated sentence). article_style is a short phrase.',
    'image_direction is the art direction every blog image of this site will follow:',
    "- medium: the kind of picture that matches the site's visual character — photograph for",
    '  product, hardware or photo-led sites; flat_illustration or isometric for software and',
    '  services with flat brand graphics; three_d_render, watercolor or line_art only when the',
    '  site itself looks that way. Screenshots, diagrams and interfaces are never a medium; when',
    '  the site suggests those, choose photograph.',
    '- palette: the site\'s brand colours as at most 6 words (e.g. "deep navy and warm white"),',
    '  or "" when none are evident.',
    '- notes: one short phrase of subject matter the images should favour (e.g. "workshop',
    '  hardware and tools"), or "".',
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
    responseSchema: SCAN_RESPONSE_SCHEMA,
  });

  const fields = ScanOutputSchema.parse(parseJsonObject(res.text));

  // SetupPresetsSchema is the single validation gate — a malformed/incomplete
  // LLM object throws here and dead-letters rather than persisting junk.
  return SetupPresetsSchema.parse({
    business: fields.business,
    // The 7-segment cap is a presets rule, not a shape the wire schema can
    // express (strict mode drops maxItems), so trim rather than let an
    // over-eager list fail the whole scan.
    audience: { target: fields.audience.target.slice(0, AUDIENCE_TARGET_MAX), competitors: [] },
    blog,
    article_preferences: fields.article_preferences,
  });
}
