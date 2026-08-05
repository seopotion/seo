import type { LlmClient, LlmUsage } from '@shared/providers';
import { buildArticlePrompt } from './article';
import { HUMANIZE } from './config';
import { buildHumanizePrompt } from './humanize';
import { sanitizeLinks } from './links';
import { buildOutlinePrompt, parseOutline } from './outline';
import { buildSemanticCheckPrompt, parseSemanticResult } from './semantic';
import type { GeneratedArticle, GenerationContext, ValidationFailure } from './types';
import { validateArticle } from './validate';

type Result =
  | { ok: true; article: GeneratedArticle }
  | { ok: false; failures: ValidationFailure[] };

/**
 * Run the full generation pipeline for one keyword: outline -> article ->
 * (optional) humanize -> deterministic + LLM validation. Throws on provider
 * errors (bubbled from llm.complete); returns { ok:false } on validation failure.
 */
export async function generateArticle(params: {
  ctx: GenerationContext;
  llm: LlmClient;
}): Promise<Result> {
  const { ctx, llm } = params;
  let totalTokens = 0;
  let costUsd: number | null = 0;
  const track = (u: LlmUsage) => {
    totalTokens += u.totalTokens;
    costUsd = costUsd === null || u.costUsd === null ? null : costUsd + u.costUsd;
  };

  const outlineRes = await llm.complete({
    messages: buildOutlinePrompt(ctx),
    responseFormat: 'json',
  });
  track(outlineRes.usage);
  const outline = parseOutline(outlineRes.text, ctx);

  const articleRes = await llm.complete({ messages: buildArticlePrompt(ctx, outline) });
  track(articleRes.usage);
  let content = articleRes.text;

  if (HUMANIZE) {
    const humanRes = await llm.complete({ messages: buildHumanizePrompt(ctx, content) });
    track(humanRes.usage);
    content = humanRes.text;
  }

  // Fail closed (#186): the model is asked for approved URLs only, but anything
  // it invented or over-placed is unwrapped to plain text here — before
  // validation, which then asserts the invariant as a backstop.
  content = sanitizeLinks(content, outline.internal_links, ctx.maxInternalLinks);

  const failures = validateArticle(
    {
      title: outline.h1,
      meta_title: outline.meta_title,
      meta_description: outline.meta_description,
      content,
    },
    ctx,
  );

  const semRes = await llm.complete({
    messages: buildSemanticCheckPrompt(ctx, content),
    responseFormat: 'json',
  });
  track(semRes.usage);
  const semantic = parseSemanticResult(semRes.text);
  if (!semantic.pass)
    failures.push({
      code: 'semantic',
      message: semantic.reasons.join('; ') || 'semantic check failed',
    });

  if (failures.length) return { ok: false, failures };

  return {
    ok: true,
    article: {
      title: outline.h1,
      meta_title: outline.meta_title,
      meta_description: outline.meta_description,
      slug: outline.slug,
      content,
      usage: { totalTokens, costUsd },
    },
  };
}
