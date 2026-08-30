import { ArticleRepo, KeywordRepo } from '@shared/db';
import {
  buildSemanticCheckPrompt,
  buildVideoEmbed,
  buildVideoPickPrompt,
  extractH2s,
  FLESCH_KINCAID_TARGET,
  injectBlockAfterHeading,
  languageCodeFromName,
  parseSemanticResult,
  parseVideoPick,
  SEMANTIC_RESPONSE_SCHEMA,
  sanitizeLinks,
  VIDEO_PICK_RESPONSE_SCHEMA,
  validateArticle,
} from '@shared/generation';
import type { ArticleRun, ArticleVideo } from '@shared/schemas';
import type { ArticleStageClients } from '../clients';
import { contextFromRun } from '../context';
import { ArticleFatalError } from '../errors';
import type { StageOutcome } from './types';

/**
 * Finalize stage: sanitize links, run deterministic + semantic validation,
 * best-effort YouTube embed, then persist the article. Ports
 * apps/worker/src/generation.ts:159-248 and generate.ts:57-81 onto a
 * checkpointed run. See the 2026-08-28 design spec.
 */
export async function stageFinalize(
  run: ArticleRun,
  clients: Pick<ArticleStageClients, 'llm' | 'youtube'>,
): Promise<StageOutcome> {
  // Redrive guard: a crash between article-create and checkpoint must not
  // create a second article.
  if (run.working.article_id) {
    return { completed: true, working: { article_id: run.working.article_id } };
  }

  const { outline } = run.working;
  const chosenContent = run.working.content;
  if (!outline || chosenContent === null) {
    throw new ArticleFatalError('finalize stage requires a checkpointed outline and content');
  }

  const { llm, youtube } = clients;
  const ctx = contextFromRun(run);
  const keyword = run.input.keyword;

  // Fail closed (#186): unwrap anything invented or over-placed before
  // validation, which then asserts the invariant as a backstop.
  let content = sanitizeLinks(chosenContent, outline.internal_links, ctx.maxInternalLinks);

  const failures = validateArticle(
    {
      title: outline.h1,
      meta_title: outline.meta_title,
      meta_description: outline.meta_description,
      content,
    },
    ctx,
    // Same set the sanitizer just enforced, not every candidate (#186).
    outline.internal_links,
  );

  const semRes = await llm.complete({
    messages: buildSemanticCheckPrompt(ctx, content),
    responseSchema: SEMANTIC_RESPONSE_SCHEMA,
  });
  const semantic = parseSemanticResult(semRes.text);
  if (!semantic.pass)
    failures.push({
      code: 'semantic',
      message: semantic.reasons.join('; ') || 'semantic check failed',
    });

  // Carry each failure's message, not just its code: a bare `validation:
  // semantic` tells an operator nothing, and the reviewer's reasons are the
  // only record of WHY the article was thrown away.
  if (failures.length)
    throw new ArticleFatalError(
      `validation: ${failures.map((f) => `${f.code}: ${f.message}`).join(' | ')}`,
    );

  // YouTube embed (#85): best-effort — any failure logs and the article
  // ships without a video; never fail or delay generation over this.
  let video: ArticleVideo | null = null;
  if (run.input.presets.article_preferences.engagement.youtube_videos) {
    try {
      const headings = extractH2s(content);
      const candidates =
        headings.length > 0
          ? await youtube.searchVideos(keyword.keyword, {
              relevanceLanguage: languageCodeFromName(run.input.presets.business.language),
            })
          : [];
      if (candidates.length > 0) {
        const res = await llm.complete({
          messages: buildVideoPickPrompt({
            articleTitle: outline.h1,
            metaDescription: outline.meta_description,
            headings,
            candidates,
          }),
          responseSchema: VIDEO_PICK_RESPONSE_SCHEMA,
        });
        const pick = parseVideoPick(res.text, candidates.length, headings);
        if (pick) {
          const chosen = candidates[pick.video_index]!;
          content = injectBlockAfterHeading(
            content,
            pick.section_heading,
            buildVideoEmbed(chosen.video_id, chosen.title),
          );
          video = {
            video_id: chosen.video_id,
            title: chosen.title,
            section_heading: pick.section_heading,
          };
        }
      }
    } catch (err) {
      console.warn('video step failed; article ships without video', err);
    }
  }

  const readability = {
    metric: 'flesch_kincaid_grade' as const,
    grade: run.working.readability_grade,
    target: FLESCH_KINCAID_TARGET,
    target_met:
      run.working.readability_grade === null ||
      run.working.readability_grade <= FLESCH_KINCAID_TARGET,
    attempts: run.working.humanize_attempts.length,
  };

  const article = await ArticleRepo.create({
    org_id: run.org_id,
    keyword_id: keyword.id,
    title: outline.h1,
    meta_title: outline.meta_title,
    slug: outline.slug,
    keyword: keyword.keyword,
    topic_cluster_id: keyword.topic_cluster_id,
    topic_cluster_label: keyword.topic_cluster_label,
    topic_role: keyword.topic_role,
    topic_content_focus: keyword.topic_content_focus,
    topic_primary_keyword: keyword.topic_primary_keyword,
    meta_description: outline.meta_description,
    featured_image_url: '', // populated by the images stages (#51)
    content,
    video,
    difficulty: keyword.difficulty,
    search_volume: keyword.search_volume,
    status: 'generated',
    published_at: null,
    readability,
  });
  await KeywordRepo.linkArticle(keyword.id, article.id);

  return { completed: true, working: { article_id: article.id } };
}
