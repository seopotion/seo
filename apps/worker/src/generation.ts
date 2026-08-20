import { ArticleRepo, IntegrationRepo, KeywordRepo, OrgRepo } from '@shared/db';
import {
  buildContext,
  buildVideoEmbed,
  buildVideoPickPrompt,
  completeTopicBrief,
  deduplicateLinkCandidates,
  deriveCandidates,
  extractH2s,
  FLESCH_KINCAID_TARGET,
  fleschKincaidGrade,
  generateArticle,
  injectBlockAfterHeading,
  type LinkCandidate,
  languageCodeFromName,
  MAX_LINK_CANDIDATES,
  type PostUrlSources,
  parseVideoPick,
  prioritizeLinkCandidates,
  verifyCandidates,
} from '@shared/generation';
import type { Article, ArticleVideo, Keyword, Org } from '@shared/schemas';
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

/**
 * Internal-link targets for this org: its own published articles, each derived
 * to a provider-shaped URL (#228) and then proven live (#186). Anything
 * unproven is dropped — an org with nothing published, or no way to name a
 * post URL, gets no links at all, whatever `internal_links_count` says.
 */
async function resolveLinkCandidates(org: Org, keyword: Keyword): Promise<LinkCandidate[]> {
  const max = org.presets?.article_preferences.content_seo.internal_links_count ?? 0;
  if (max <= 0) return [];

  let staticSitePostBase: string | null = null;
  for (const integration of await IntegrationRepo.listByOrgId(org.id)) {
    if (integration.provider === 'static-site') staticSitePostBase = integration.post_url_base;
  }
  const sources: PostUrlSources = { staticSitePostBase };

  const topic = completeTopicBrief(keyword);
  const publishedSeen = new Set<string>();
  const eligible = (articles: Article[]) => {
    const rows = articles.filter(
      (article) => article.org_id === org.id && article.status === 'published',
    );
    for (const row of rows) publishedSeen.add(row.id);
    return rows;
  };
  let derived: LinkCandidate[];

  if (topic) {
    const complementaryRole = topic.topic_role === 'pillar' ? 'support' : 'pillar';
    const complementary = eligible(
      await ArticleRepo.listPublishedByTopicCluster(org.id, topic.topic_cluster_id, {
        limit: MAX_LINK_CANDIDATES,
        role: { value: complementaryRole, mode: 'include' },
      }),
    );
    let sameClusterCandidates = deriveCandidates(sources, complementary);
    if (sameClusterCandidates.length < MAX_LINK_CANDIDATES) {
      const remainingSameCluster = eligible(
        await ArticleRepo.listPublishedByTopicCluster(org.id, topic.topic_cluster_id, {
          limit: MAX_LINK_CANDIDATES,
          role: { value: complementaryRole, mode: 'exclude' },
        }),
      );
      sameClusterCandidates = deduplicateLinkCandidates([
        ...sameClusterCandidates,
        ...deriveCandidates(sources, remainingSameCluster),
      ]);
    }
    let gathered = sameClusterCandidates;
    if (sameClusterCandidates.length < MAX_LINK_CANDIDATES) {
      const { articles } = await ArticleRepo.listByOrg(org.id, {
        status: 'published',
        limit: MAX_LINK_CANDIDATES,
        offset: 0,
      });
      gathered = [...sameClusterCandidates, ...deriveCandidates(sources, eligible(articles))];
    }
    derived = deduplicateLinkCandidates(prioritizeLinkCandidates(topic, gathered)).slice(
      0,
      MAX_LINK_CANDIDATES,
    );
  } else {
    const { articles } = await ArticleRepo.listByOrg(org.id, {
      status: 'published',
      limit: MAX_LINK_CANDIDATES,
      offset: 0,
    });
    derived = deriveCandidates(sources, eligible(articles)).slice(0, MAX_LINK_CANDIDATES);
  }

  const candidates = (await verifyCandidates(derived)).slice(0, MAX_LINK_CANDIDATES);
  if (publishedSeen.size > 0 && candidates.length === 0) {
    // The one signal that separates "this org published nothing" from "we
    // failed to place a single link for an org that DID publish" (#228).
    logger.warn('internal links: published articles yielded no usable candidates', {
      published: publishedSeen.size,
      derived: derived.length,
      verified: 0,
    });
  }
  logger.info('internal link candidates resolved', {
    derived: derived.length,
    verified: candidates.length,
  });
  return candidates;
}

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

      const ctx = buildContext(org, keyword, await resolveLinkCandidates(org, keyword));
      const { llm, youtube } = await getGenerationClients();
      const result = await generateArticle({ ctx, llm });

      if (!result.ok) {
        const codes = result.failures.map((f) => f.code).join(', ');
        logger.warn('generation validation failed', { failures: result.failures });
        await KeywordRepo.failGeneration(keywordId, `validation: ${codes}`);
        continue;
      }

      if (ctx.language === 'English') {
        const fkGrade = fleschKincaidGrade(result.article.content);
        const readability = {
          readability_metric: 'flesch_kincaid_grade',
          fk_grade: fkGrade,
          fk_target: FLESCH_KINCAID_TARGET,
          fk_target_met: fkGrade !== null && fkGrade <= FLESCH_KINCAID_TARGET,
        };
        logger.info('article readability measured', readability);
        if (fkGrade !== null && fkGrade > FLESCH_KINCAID_TARGET) {
          logger.warn('article readability above target', readability);
        }
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
        topic_cluster_id: keyword.topic_cluster_id,
        topic_cluster_label: keyword.topic_cluster_label,
        topic_role: keyword.topic_role,
        topic_content_focus: keyword.topic_content_focus,
        topic_primary_keyword: keyword.topic_primary_keyword,
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
