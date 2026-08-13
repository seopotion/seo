import { ArticleRepo, IntegrationRepo, OrgRepo } from '@shared/db';
import { isPaid, PublishTask } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { decryptSecret } from '../../api/src/lib/crypto';
import { publishStaticSiteArticle, publishWordPressArticle } from '../../api/src/lib/publishers';
import {
  isIntegrationPublishingError,
  normalizePublishingError,
  publishingFailure,
} from '../../api/src/lib/publishing-errors';
import { getGscTokenKey } from '../../api/src/lib/secrets';
import { logger } from './logger';

const MAX_ATTEMPTS = 3;
const CLAIM_LEASE_MS = 5 * 60_000;

export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let keys: { org_id?: string; article_id?: string; provider?: string } = {};
    try {
      const task = PublishTask.parse(JSON.parse(record.body));
      keys = { org_id: task.org_id, article_id: task.article_id, provider: task.provider };
      logger.appendKeys(keys);

      let article = await ArticleRepo.findById(task.article_id);
      if (!article) {
        logger.warn('auto-publish skipped: article missing');
        continue;
      }
      if (article.org_id !== task.org_id) {
        logger.warn('auto-publish skipped: task organization mismatch');
        continue;
      }

      const existing = article.publications.find(
        (publication) => publication.provider === task.provider,
      );
      if (existing) {
        if (task.provider === 'wordpress') {
          const postId = Number(existing.ref);
          if (Number.isInteger(postId) && postId > 0) {
            await ArticleRepo.setWordPressPostId(article.id, postId);
          }
        }
        await ArticleRepo.completeAutoPublishAttempt(article.id, task.provider);
        await IntegrationRepo.setError(task.org_id, task.provider, null);
        logger.info('auto-publish reconciled from existing publication');
        continue;
      }

      const org = await OrgRepo.findByIdWithoutSecrets(task.org_id);
      if (!org?.presets) {
        const failure = publishingFailure(
          'invalid_article_payload',
          'permanent',
          'The organization publishing settings are unavailable.',
          422,
        );
        await ArticleRepo.failAutoPublishAttempt(article.id, task.provider, failure.error);
        logger.warn('auto-publish failed before claim', { error_code: failure.error.code });
        continue;
      }
      if (article.images_status !== 'complete') {
        const failure = publishingFailure(
          article.images_status === 'failed' ? 'image_generation_failed' : 'images_incomplete',
          'permanent',
          article.images_status === 'failed'
            ? 'Article image generation failed. Retry images before publishing.'
            : 'Article images are not complete.',
          409,
        );
        await ArticleRepo.failAutoPublishAttempt(article.id, task.provider, failure.error);
        logger.warn('auto-publish failed before claim', { error_code: failure.error.code });
        continue;
      }
      if (!org.presets.article_preferences.publishing.auto_publish) {
        const failure = publishingFailure(
          'auto_publish_disabled',
          'permanent',
          'Automatic publishing was disabled before this task ran.',
          409,
        );
        await ArticleRepo.cancelAutoPublishAttempt(article.id, task.provider, failure.error);
        logger.info('auto-publish cancelled: setting disabled');
        continue;
      }
      if (!isPaid(org)) {
        const failure = publishingFailure(
          'subscription_required',
          'permanent',
          'Automatic publishing requires a paid or expert plan.',
          422,
        );
        await ArticleRepo.failAutoPublishAttempt(article.id, task.provider, failure.error);
        logger.warn('auto-publish failed before claim', { error_code: failure.error.code });
        continue;
      }

      const integration = await IntegrationRepo.findByOrgAndProvider(task.org_id, task.provider);
      if (!integration || integration.provider !== task.provider) {
        const failure = publishingFailure(
          'not_connected',
          'permanent',
          `The ${task.provider === 'wordpress' ? 'WordPress' : 'static-site'} connection is missing.`,
          409,
        );
        await ArticleRepo.failAutoPublishAttempt(article.id, task.provider, failure.error);
        logger.warn('auto-publish failed before claim', { error_code: failure.error.code });
        continue;
      }

      const claim = await ArticleRepo.claimAutoPublishAttempt(
        article.id,
        task.provider,
        new Date(),
        CLAIM_LEASE_MS,
      );
      if (!claim) {
        article = (await ArticleRepo.findById(article.id)) ?? article;
        const publication = article.publications.find((entry) => entry.provider === task.provider);
        if (publication) {
          await ArticleRepo.completeAutoPublishAttempt(article.id, task.provider);
          await IntegrationRepo.setError(task.org_id, task.provider, null);
          logger.info('auto-publish reconciled after claim race');
        } else {
          logger.info('auto-publish skipped: attempt already claimed or terminal');
        }
        continue;
      }

      try {
        const result =
          integration.provider === 'wordpress'
            ? await publishWordPressArticle({
                article,
                websiteUrl: integration.site_url,
                token: await (async () => {
                  try {
                    return decryptSecret(integration.token_enc, await getGscTokenKey());
                  } catch {
                    throw publishingFailure(
                      'invalid_credentials',
                      'permanent',
                      'The WordPress credentials cannot be decrypted. Reconnect the site.',
                      422,
                    );
                  }
                })(),
                automatic: true,
                at: claim.requested_at,
              })
            : await publishStaticSiteArticle({
                article,
                integration,
                at: claim.requested_at,
              });

        if (task.provider === 'wordpress') {
          const persisted = await ArticleRepo.recordPublication(
            article.id,
            {
              provider: task.provider,
              ref: result.ref,
              slug: result.slug,
              remote_url: result.remote_url,
            },
            { publishedAt: result.published_at, updatedAt: null },
          );
          if (!persisted) {
            throw publishingFailure(
              'record_failed',
              'transient',
              'The remote publication succeeded but local state could not be saved.',
              500,
            );
          }
          await ArticleRepo.setWordPressPostId(article.id, Number(result.ref));
        }
        await ArticleRepo.completeAutoPublishAttempt(article.id, task.provider);
        await IntegrationRepo.setError(task.org_id, task.provider, null);
        logger.info('auto-publish completed', { attempt: claim.attempt_count });
      } catch (err) {
        const failure = normalizePublishingError(err, task.provider);
        if (
          failure.error.kind === 'permanent' &&
          isIntegrationPublishingError(failure.error.code)
        ) {
          await IntegrationRepo.setError(task.org_id, task.provider, failure.error.code);
        }
        if (failure.error.kind === 'transient') {
          if (claim.attempt_count >= MAX_ATTEMPTS) {
            await ArticleRepo.failAutoPublishAttempt(
              article.id,
              task.provider,
              failure.error,
              claim.lease_expires_at ?? undefined,
            );
          } else {
            await ArticleRepo.recordAutoPublishRetry(
              article.id,
              task.provider,
              claim.lease_expires_at as Date,
              failure.error,
            );
          }
          logger.warn('auto-publish transient failure', {
            error_code: failure.error.code,
            attempt: claim.attempt_count,
          });
          throw failure;
        }
        await ArticleRepo.failAutoPublishAttempt(
          article.id,
          task.provider,
          failure.error,
          claim.lease_expires_at ?? undefined,
        );
        logger.warn('auto-publish permanent failure', {
          error_code: failure.error.code,
          attempt: claim.attempt_count,
        });
      }
    } catch (err) {
      logger.error('auto-publish task failed', {
        messageId: record.messageId,
        error_code:
          err instanceof Error && 'error' in err
            ? String((err as { error?: { code?: unknown } }).error?.code ?? 'task_failed')
            : 'task_failed',
      });
      throw err;
    } finally {
      logger.removeKeys(Object.keys(keys));
    }
  }
};
