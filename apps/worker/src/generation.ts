import { ArticleRepo, KeywordRepo, OrgRepo } from '@shared/db';
import {
  buildContext,
  buildVideoEmbed,
  buildVideoPickPrompt,
  extractH2s,
  generateArticle,
  injectBlockAfterHeading,
  languageCodeFromName,
  parseVideoPick,
} from '@shared/generation';
import type { ArticleVideo } from '@shared/schemas';
import { GenerateTask, isPaid } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getGenerationClients } from './providers';
import { enqueueImageTask } from './queue';

/**
 * Generation worker — triggered by SQS (enqueued by the daily generation
 * scheduler). Atomically claims a due keyword, runs the generation pipeline,
 * persists a `generated` article, and links keyword.article_id. Validation
 * failures are recorded on the keyword (not published); provider errors are
 * recorded and rethrown so SQS redelivers (-> DLQ). See design & epic #56 / #55.
 */
export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let keywordId: string | undefined;
    try {
      const task = GenerateTask.parse(JSON.parse(record.body));
      keywordId = task.keyword_id;
      logger.appendKeys({ org_id: task.org_id, keyword_id: keywordId });

      // Atomic claim: only one worker proceeds; already-done/in-flight -> skip.
      if (!(await KeywordRepo.claimGeneration(keywordId))) {
        logger.info('generation skipped: keyword not claimable');
        continue;
      }

      const org = await OrgRepo.findById(task.org_id);
      if (!org?.presets) {
        logger.warn('generation skipped: org or presets missing');
        await KeywordRepo.failGeneration(keywordId, 'org or presets missing');
        continue;
      }
      if (!isPaid(org)) {
        logger.info('generation skipped: org not paid');
        await KeywordRepo.failGeneration(keywordId, 'org not paid');
        continue;
      }

      const keyword = await KeywordRepo.findById(keywordId);
      if (!keyword) {
        logger.warn('generation skipped: keyword missing');
        continue;
      }

      const ctx = buildContext(org, keyword);
      const { llm, youtube } = getGenerationClients();
      const result = await generateArticle({ ctx, llm });

      if (!result.ok) {
        const codes = result.failures.map((f) => f.code).join(', ');
        logger.warn('generation validation failed', { failures: result.failures });
        await KeywordRepo.failGeneration(keywordId, `validation: ${codes}`);
        continue;
      }

      // YouTube embed (#85): best-effort — any failure logs and the article
      // ships without a video; never fail or delay generation over this.
      let content = result.article.content;
      let video: ArticleVideo | null = null;
      if (org.presets.article_preferences.engagement.youtube_videos) {
        try {
          const headings = extractH2s(content);
          const candidates =
            headings.length > 0
              ? await youtube.searchVideos(keyword.keyword, {
                  relevanceLanguage: languageCodeFromName(org.presets.business.language),
                })
              : [];
          if (candidates.length > 0) {
            const res = await llm.complete({
              messages: buildVideoPickPrompt({
                articleTitle: result.article.title,
                metaDescription: result.article.meta_description,
                headings,
                candidates,
              }),
              responseFormat: 'json',
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
          logger.warn('video step failed; article ships without video', { error: err as Error });
        }
      }

      const article = await ArticleRepo.create({
        org_id: org.id,
        keyword_id: keyword.id,
        title: result.article.title,
        meta_title: result.article.meta_title,
        slug: result.article.slug,
        keyword: keyword.keyword,
        meta_description: result.article.meta_description,
        featured_image_url: '', // populated by the images worker (#51)
        content,
        video,
        difficulty: keyword.difficulty,
        search_volume: keyword.search_volume,
        status: 'generated',
        published_at: null,
      });
      await KeywordRepo.linkArticle(keyword.id, article.id);
      try {
        await enqueueImageTask({ org_id: org.id, article_id: article.id });
      } catch (err) {
        // Article is generated and linked; images stay 'pending' and can be
        // re-enqueued manually — never fail the generation over this (#51).
        logger.error('image task enqueue failed; images stay pending', { error: err as Error });
      }
      logger.info('article generated', { article_id: article.id });
    } catch (err) {
      // Record the failure, then rethrow so SQS redelivers (-> DLQ after N).
      if (keywordId)
        await KeywordRepo.failGeneration(keywordId, (err as Error).message).catch(() => {});
      logger.error('generation failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id', 'keyword_id']);
    }
  }
};
