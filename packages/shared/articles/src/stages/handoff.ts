import { ArticleRepo, IntegrationRepo, OrgRepo } from '@shared/db';
import type { ArticleRun } from '@shared/schemas';
import { PublishTask } from '@shared/schemas';
import { encryptSecret } from '../../../../../apps/api/src/lib/crypto';
import { publishingFailure } from '../../../../../apps/api/src/lib/publishing-errors';
import { getGscTokenKey } from '../../../../../apps/api/src/lib/secrets';
import { ArticleFatalError } from '../errors';
import { enqueuePublishTask } from '../sqs';
import type { StageOutcome } from './types';

/**
 * Hands a completed article off to auto-publish: queue one PublishTask per
 * connected destination, backfilling a WordPress-mirror connection first if
 * that's the only credential on record. Ports apps/worker/src/images.ts's
 * handoffToPublishing (lines 79-126) onto a checkpointed run — same guards,
 * same WordPress-mirror bridge. Guard failures (org mismatch, images not
 * complete, auto-publish off) return quietly; only a missing article is
 * fatal. See the 2026-08-28 design spec.
 */
export async function stageHandoffPublish(run: ArticleRun): Promise<StageOutcome> {
  const articleId = run.working.article_id;
  if (!articleId) throw new ArticleFatalError('handoff stage requires a checkpointed article_id');

  const orgId = run.org_id;
  const [article, org] = await Promise.all([
    ArticleRepo.findById(articleId),
    OrgRepo.findByIdWithoutSecrets(orgId),
  ]);
  if (!article) throw new ArticleFatalError(`handoff stage: article ${articleId} not found`);
  if (article.org_id !== orgId || article.images_status !== 'complete' || !org?.presets) {
    return { completed: true, working: {} };
  }
  if (!org.presets.article_preferences.publishing.auto_publish) {
    return { completed: true, working: {} };
  }

  let integrations = await IntegrationRepo.listByOrgId(orgId);
  if (!integrations.some((integration) => integration.provider === 'wordpress')) {
    const mirror = org.wordpress_connected_at ? await OrgRepo.findWordPressMirror(orgId) : null;
    if (mirror) {
      const tokenEnc = encryptSecret(mirror.token, await getGscTokenKey());
      await IntegrationRepo.connectWordPress(orgId, mirror.website_url, tokenEnc);
      const wordpress = await IntegrationRepo.findByOrgAndProvider(orgId, 'wordpress');
      if (wordpress) integrations = [...integrations, wordpress];
    }
  }

  const providers = [...new Set(integrations.map((integration) => integration.provider))];
  if (providers.length === 0) {
    await ArticleRepo.recordAutoPublishPreflightError(
      articleId,
      publishingFailure(
        'not_connected',
        'permanent',
        'Connect WordPress or a static site to publish this article automatically.',
        409,
      ).error,
    );
    console.warn('auto-publish handoff skipped: no connected destination');
    return { completed: true, working: {} };
  }

  await ArticleRepo.clearAutoPublishPreflightError(articleId);
  for (const provider of providers) {
    await ArticleRepo.initializeAutoPublishAttempt(articleId, provider);
    await enqueuePublishTask(PublishTask.parse({ org_id: orgId, article_id: articleId, provider }));
    console.info('auto-publish task queued', { provider });
  }

  return { completed: true, working: {} };
}
