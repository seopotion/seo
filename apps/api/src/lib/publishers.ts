import { randomUUID } from 'node:crypto';
import { ArticleRepo, IntegrationRepo } from '@shared/db';
import type { Article, Integration } from '@shared/schemas';
import type { CommitFile } from '../clients/github';
import { commitFiles } from '../clients/github';
import {
  editWordPressArticle,
  getWordPressCapabilities,
  submitWordPressArticle,
  type WordPressArticleResponse,
} from '../clients/wordpress';
import { normalizePublishingError, publishingFailure } from './publishing-errors';
import {
  articlePath,
  manifestEntry,
  manifestPath,
  type PublishedArticle,
  parseManifest,
  renderArticle,
  renderManifestEntries,
  type StaticSiteManifestArticle,
} from './static-site';

type StaticSiteIntegration = Extract<Integration, { provider: 'static-site' }>;

export interface ProviderPublishResult {
  ref: string;
  slug: string;
  remote_url: string | null;
  published_at: Date;
}

export interface WordPressPublishResult extends ProviderPublishResult {
  post_id: number;
  response: WordPressArticleResponse;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function wordpressFailure(
  result: Exclude<Awaited<ReturnType<typeof submitWordPressArticle>>, { status: 200 }>,
  operation: 'automatic-submit' | 'manual-create' | 'manual-update',
) {
  if (result.status === 400) {
    return publishingFailure(
      'invalid_article_payload',
      'permanent',
      'WordPress rejected the article payload.',
      400,
    );
  }
  if (result.status === 403) {
    return publishingFailure(
      'wordpress_auth_failed',
      'permanent',
      'WordPress rejected the integration credentials. Reconnect the site.',
      403,
    );
  }
  if (result.status === 404) {
    if (operation === 'manual-update') {
      return publishingFailure(
        'wordpress_post_not_found',
        'permanent',
        'The WordPress post no longer exists.',
        404,
      );
    }
    if (operation === 'manual-create') {
      return publishingFailure(
        'wordpress_plugin_unavailable',
        'permanent',
        'The WordPress publishing endpoint is unavailable. Check the plugin connection.',
        404,
      );
    }
    return publishingFailure(
      'plugin_upgrade_required',
      'permanent',
      'The WordPress plugin must be upgraded before this article can be published safely.',
      404,
    );
  }
  if (result.status === 409 && result.body.code === 'source_publish_in_progress') {
    return publishingFailure(
      'wordpress_publish_in_progress',
      'transient',
      'WordPress is already processing this article. Retry shortly.',
      502,
    );
  }
  if (result.status === 409) {
    return publishingFailure(
      'slug_conflict',
      'permanent',
      'WordPress already has another post using this slug.',
      409,
    );
  }
  return publishingFailure(
    'wordpress_request_failed',
    'transient',
    'WordPress could not publish the article. Retry shortly.',
    500,
  );
}

function supportsSafeIdempotentPublish(version: string, capabilities: string[]): boolean {
  if (!capabilities.includes('idempotent_publish')) return false;
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return major > 1 || (major === 1 && minor >= 2);
}

export async function publishWordPressArticle(input: {
  article: Article;
  websiteUrl: string;
  token: string;
  automatic: boolean;
  at?: Date;
}): Promise<WordPressPublishResult> {
  const at = input.at ?? new Date();
  try {
    if (input.automatic) {
      const capabilities = await getWordPressCapabilities(input.websiteUrl);
      if (
        !capabilities ||
        !supportsSafeIdempotentPublish(capabilities.version, capabilities.capabilities)
      ) {
        throw publishingFailure(
          'plugin_upgrade_required',
          'permanent',
          'The WordPress plugin must be upgraded before automatic publishing can run safely.',
          422,
          at,
        );
      }
    }

    const result = input.automatic
      ? await submitWordPressArticle(input.websiteUrl, input.token, input.article, {
          sourceArticleId: input.article.id,
          status: 'publish',
        })
      : await submitWordPressArticle(input.websiteUrl, input.token, input.article);
    if (result.status !== 200) {
      throw wordpressFailure(result, input.automatic ? 'automatic-submit' : 'manual-create');
    }

    const response = result.body;
    if (input.automatic) {
      if (!response.slug || !isHttpUrl(response.permalink) || response.post_status !== 'publish') {
        throw publishingFailure(
          'invalid_provider_response',
          'transient',
          'WordPress did not confirm a live published post.',
          502,
          at,
        );
      }
    }
    return {
      ref: String(response.post_id),
      post_id: response.post_id,
      slug: response.slug ?? input.article.slug,
      remote_url: isHttpUrl(response.permalink) ? response.permalink : null,
      published_at: at,
      response,
    };
  } catch (err) {
    throw normalizePublishingError(err, 'wordpress', at);
  }
}

export async function updateWordPressArticle(input: {
  article: Article;
  websiteUrl: string;
  token: string;
  postId: number;
  at?: Date;
}): Promise<WordPressPublishResult> {
  const at = input.at ?? new Date();
  try {
    const result = await editWordPressArticle(
      input.websiteUrl,
      input.token,
      input.postId,
      input.article,
    );
    if (result.status !== 200) throw wordpressFailure(result, 'manual-update');
    return {
      ref: String(result.body.post_id),
      post_id: result.body.post_id,
      slug: result.body.slug ?? input.article.slug,
      remote_url: isHttpUrl(result.body.permalink) ? result.body.permalink : null,
      published_at: at,
      response: result.body,
    };
  } catch (err) {
    throw normalizePublishingError(err, 'wordpress', at);
  }
}

function toPublishedArticle(article: Article): PublishedArticle | null {
  const publication = article.publications.find((entry) => entry.provider === 'static-site');
  if (!publication) return null;
  return {
    article,
    slug: publication.slug,
    published_at: publication.published_at,
    updated_at: publication.updated_at,
  };
}

function replaceManifestEntry(
  entries: StaticSiteManifestArticle[],
  next: StaticSiteManifestArticle,
  legacySlug: string,
): void {
  const index = entries.findIndex(
    (entry) =>
      entry.source_article_id === next.source_article_id ||
      (entry.source_article_id === null && entry.slug === legacySlug),
  );
  if (index === -1) entries.push(next);
  else entries[index] = next;
}

function sameManifestEntry(
  left: StaticSiteManifestArticle,
  right: StaticSiteManifestArticle,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function optionalManifestDate(value: string | null): Date | null | undefined {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function orphanUpdateTimestamp(
  article: Article,
  remotePublishedAt: Date,
  remoteUpdatedAt: Date | null,
): Date {
  const remoteVersionAt = remoteUpdatedAt ?? remotePublishedAt;
  return article.updated_at && article.updated_at > remoteVersionAt
    ? article.updated_at
    : remoteVersionAt;
}

function manifestGeneratedAt(remoteGeneratedAt: string, publicationAt: Date): string {
  return Date.parse(remoteGeneratedAt) >= publicationAt.getTime()
    ? remoteGeneratedAt
    : publicationAt.toISOString();
}

const STATIC_PUBLISH_LEASE_MS = 6 * 60_000;

export async function publishStaticSiteArticle(input: {
  article: Article;
  integration: StaticSiteIntegration;
  at?: Date;
}): Promise<ProviderPublishResult & { remote_url: string; path: string }> {
  const at = input.at ?? new Date();
  const { article, integration } = input;
  const leaseToken = randomUUID();
  const claimed = await IntegrationRepo.claimPublishLease(
    article.org_id,
    'static-site',
    leaseToken,
    new Date(),
    STATIC_PUBLISH_LEASE_MS,
  );
  if (!claimed) {
    throw publishingFailure(
      'static_publish_in_progress',
      'transient',
      'Another static-site article is being published. Retry shortly.',
      409,
      at,
    );
  }

  try {
    const previous = article.publications.find((entry) => entry.provider === 'static-site');
    const path = articlePath(integration.content_path, article.slug);
    let recordTimestamps = {
      publishedAt: previous?.published_at ?? at,
      updatedAt: previous ? at : null,
    };

    const ref = await commitFiles({
      installationId: integration.installation_id,
      repo: integration.repo,
      branch: integration.branch,
      message: `seopotion: ${previous ? 'update' : 'publish'} "${article.title}"`,
      prepare: async ({ readFile }) => {
        const remoteContent = await readFile(manifestPath(integration.content_path));
        const remote = remoteContent
          ? parseManifest(remoteContent)
          : { generated_at: at.toISOString(), articles: [] };
        const remoteOwned = remote.articles.find((entry) => entry.source_article_id === article.id);
        const remoteArticle = remoteOwned ? await readFile(remoteOwned.path) : null;
        let generatedAt: string;
        let published: PublishedArticle;
        if (!previous && remoteOwned) {
          const remotePublishedAt = new Date(remoteOwned.published_at);
          const remoteUpdatedAt = optionalManifestDate(remoteOwned.updated_at);
          const recoveryCandidate: PublishedArticle | null =
            remoteUpdatedAt === undefined
              ? null
              : {
                  article,
                  slug: article.slug,
                  published_at: remotePublishedAt,
                  updated_at: remoteUpdatedAt,
                };
          const matchesRemote =
            recoveryCandidate !== null &&
            sameManifestEntry(
              remoteOwned,
              manifestEntry(recoveryCandidate, integration.content_path),
            ) &&
            remoteArticle === renderArticle(recoveryCandidate);
          if (matchesRemote && recoveryCandidate) {
            published = recoveryCandidate;
            generatedAt = remote.generated_at;
          } else {
            const updatedAt = orphanUpdateTimestamp(
              article,
              remotePublishedAt,
              remoteUpdatedAt ?? null,
            );
            published = {
              article,
              slug: article.slug,
              published_at: remotePublishedAt,
              updated_at: updatedAt,
            };
            generatedAt = manifestGeneratedAt(remote.generated_at, updatedAt);
          }
        } else {
          published = {
            article,
            slug: article.slug,
            published_at: previous?.published_at ?? at,
            updated_at: previous ? at : null,
          };
          generatedAt = manifestGeneratedAt(
            remote.generated_at,
            published.updated_at ?? published.published_at,
          );
        }
        recordTimestamps = {
          publishedAt: published.published_at,
          updatedAt: published.updated_at,
        };
        const desiredEntry = manifestEntry(published, integration.content_path);
        const desiredArticle = renderArticle(published);
        const entries = [...remote.articles];
        const live = (await ArticleRepo.listPublishedTo(article.org_id, 'static-site'))
          .map(toPublishedArticle)
          .filter((entry) => entry !== null);
        for (const entry of live) {
          replaceManifestEntry(entries, manifestEntry(entry, integration.content_path), entry.slug);
        }
        const ownsEntry = (entry: StaticSiteManifestArticle) =>
          entry.source_article_id === article.id ||
          (entry.source_article_id === null && previous?.slug === entry.slug);
        if (entries.some((entry) => entry.slug === article.slug && !ownsEntry(entry))) {
          throw publishingFailure(
            'slug_conflict',
            'permanent',
            `Another article is already published at "${article.slug}".`,
            409,
            at,
          );
        }

        const merged = entries.filter((entry) => !ownsEntry(entry));
        merged.push(desiredEntry);
        const files: CommitFile[] = [
          { path, content: desiredArticle },
          {
            path: manifestPath(integration.content_path),
            content: renderManifestEntries(merged, generatedAt),
          },
        ];
        const oldSlug = previous?.slug ?? remoteOwned?.slug;
        if (oldSlug && oldSlug !== article.slug) {
          files.push({ path: articlePath(integration.content_path, oldSlug), content: null });
        }
        return files;
      },
    });
    const publication = {
      provider: 'static-site' as const,
      ref,
      slug: article.slug,
      remote_url: `https://github.com/${integration.repo}/commit/${ref}`,
    };
    const persisted = await ArticleRepo.recordPublication(
      article.id,
      publication,
      recordTimestamps,
    );
    if (!persisted) {
      throw publishingFailure(
        'record_failed',
        'transient',
        'The remote publication succeeded but local state could not be saved.',
        500,
        at,
      );
    }
    return {
      ref,
      slug: article.slug,
      remote_url: `https://github.com/${integration.repo}/commit/${ref}`,
      published_at: recordTimestamps.publishedAt,
      path,
    };
  } catch (err) {
    throw normalizePublishingError(err, 'static-site', at);
  } finally {
    await IntegrationRepo.releasePublishLease(article.org_id, 'static-site', leaseToken).catch(
      () => {},
    );
  }
}
