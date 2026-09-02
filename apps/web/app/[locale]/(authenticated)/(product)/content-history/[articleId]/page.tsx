'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Pencil, RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArticleContentPreview } from '@/components/article/ArticleContentPreview';
import {
  ARTICLE_EDITOR_TITLE_ID,
  ArticleEditorDetailItem,
  ArticleEditorPanel,
} from '@/components/article/ArticleEditorPanel';
import {
  Badge,
  Button,
  EmptyState,
  PageDescription,
  PageTitle,
  Separator,
  StatusPanel,
} from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import {
  type ArticleDetailResponse,
  type ArticleStatus,
  useArticleEditor,
} from '@/lib/article-editor';
import { clearToken } from '@/lib/auth';
import {
  ATTEMPT_BADGE_VARIANTS,
  AUTO_PUBLISH_BADGE_VARIANTS,
  type AutoPublishAggregateStatus,
  type AutoPublishAttempt,
  type AutoPublishAttemptStatus,
  type AutoPublishRetryState,
  beginAutoPublishRetry,
  completeAutoPublishRetryRequest,
  createAutoPublishRetryState,
  failAutoPublishRetryRequest,
  getArticlePublishingStateVersion,
  getAutoPublishAggregateState,
  getAutoPublishRetryResult,
  getPublishingErrorPresentation,
  getSafePublicationUrl,
  hasObservedManualPublishTarget,
  isArticlePublishingBlocked,
  joinPublishingProviders,
  type ManualPublishRefreshTarget,
  type ManualWordPressErrorState,
  type ProviderPublishingState,
  type PublishingErrorAction,
  type PublishingErrorPresentation,
  type PublishingProvider,
  reconcileAutoPublishRetry,
  reduceManualWordPressError,
  shouldOfferAutoPublishRetry,
} from '@/lib/auto-publishing';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useConnectedIntegrations } from '@/lib/integrations';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';

type ArticleLoadState = 'error' | 'loading' | 'not_found' | 'ready';
type WordPressActionState = 'error' | 'idle' | 'loading' | 'published' | 'updated';
type SiteActionState = 'error' | 'idle' | 'loading' | 'published';
/** Publish failures the user can act on; anything else falls back to `failed`. */
type SiteErrorKey =
  | 'branchMoved'
  | 'commitRejected'
  | 'failed'
  | 'imagesIncomplete'
  | 'notConnected'
  | 'recordFailed'
  | 'slugConflict';

const SITE_ERROR_KEYS: Record<string, SiteErrorKey> = {
  not_connected: 'notConnected',
  images_incomplete: 'imagesIncomplete',
  slug_conflict: 'slugConflict',
  ref_conflict: 'branchMoved',
  commit_rejected: 'commitRejected',
  missing_write_permission: 'commitRejected',
  record_failed: 'recordFailed',
};

const AUTO_PUBLISH_STATUS_KEYS = {
  needs_attention: 'publishing.statuses.needsAttention',
  not_queued: 'publishing.statuses.notQueued',
  published: 'publishing.statuses.published',
  publishing: 'publishing.statuses.publishing',
  queued: 'publishing.statuses.queued',
  retrying: 'publishing.statuses.retrying',
} as const satisfies Record<AutoPublishAggregateStatus, string>;

const ATTEMPT_STATUS_KEYS = {
  cancelled: 'publishing.attemptStatuses.cancelled',
  failed: 'publishing.attemptStatuses.failed',
  published: 'publishing.attemptStatuses.published',
  publishing: 'publishing.attemptStatuses.publishing',
  queued: 'publishing.attemptStatuses.queued',
  retrying: 'publishing.attemptStatuses.retrying',
} as const satisfies Record<AutoPublishAttemptStatus, string>;

export default function ArticleDetailPage() {
  const t = useTranslations('ArticleDetailPage');
  const editorT = useTranslations('ArticleEditor');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ articleId?: string | string[] }>();
  const articleId = Array.isArray(params.articleId) ? params.articleId[0] : params.articleId;
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const [redirecting, setRedirecting] = useState(false);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [wordpressActionState, setWordpressActionState] = useState<WordPressActionState>('idle');
  const [wordpressError, setWordpressError] = useState<ManualWordPressErrorState>(null);
  const [wordpressWarnings, setWordpressWarnings] = useState<string[]>([]);
  const [siteActionState, setSiteActionState] = useState<SiteActionState>('idle');
  const [siteErrorKey, setSiteErrorKey] = useState<SiteErrorKey>('failed');
  const [siteCommitUrl, setSiteCommitUrl] = useState<string | null>(null);
  const [manualRefreshTargets, setManualRefreshTargets] = useState<ManualPublishRefreshTarget[]>(
    [],
  );
  const [retryRequest, setRetryRequest] = useState<AutoPublishRetryState>(() =>
    createAutoPublishRetryState(null),
  );
  const retryRequestRef = useRef(retryRequest);
  const routeScope = organization && articleId ? `${organization.id}:${articleId}` : null;
  const activeScopeRef = useRef(routeScope);
  activeScopeRef.current = routeScope;
  const forcePublishingStateRefresh =
    (retryRequest.scope === routeScope && retryRequest.phase === 'awaiting_authoritative') ||
    manualRefreshTargets.some((target) => target.scope === routeScope);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const leaveEditMode = useCallback(() => setEditing(false), []);

  const editor = useArticleEditor({
    articleId: articleId ?? null,
    enabled: !redirecting && !organizationLoading && Boolean(organization),
    forcePublishingStateRefresh,
    onClose: leaveEditMode,
    onUnauthorized: handleUnauthorized,
    organizationId: organization?.id ?? '',
    pollPublishingState: true,
  });
  const { dirty, draftArticle, requestClose } = editor;
  const article = editor.article;
  const providerPublishingStates = article
    ? joinPublishingProviders(article.auto_publish_attempts, article.publications)
    : [];
  const autoPublishAggregate = article
    ? getAutoPublishAggregateState({
        autoPublishError: article.auto_publish_error,
        attempts: article.auto_publish_attempts,
        publications: article.publications,
      })
    : null;
  const retryAvailable = article
    ? shouldOfferAutoPublishRetry({
        autoPublishError: article.auto_publish_error,
        attempts: article.auto_publish_attempts,
        publications: article.publications,
      })
    : false;
  const retryScope = article && routeScope ? routeScope : null;
  const articlePublishingStateVersion = article ? getArticlePublishingStateVersion(article) : null;
  const retryPhase = retryRequest.scope === retryScope ? retryRequest.phase : 'idle';
  const retryFeedback = retryRequest.scope === retryScope ? retryRequest.feedback : null;
  // Publishing pushes the *saved* record, so shipping mid-edit would silently
  // publish the old text. Blocked until the draft is saved or discarded.
  const publishBlocked = isArticlePublishingBlocked(editing, dirty);

  const updateRetryRequest = useCallback((next: AutoPublishRetryState) => {
    retryRequestRef.current = next;
    setRetryRequest(next);
  }, []);

  useEffect(() => {
    if (retryRequestRef.current.scope !== routeScope) {
      updateRetryRequest(createAutoPublishRetryState(routeScope));
    }
    setManualRefreshTargets([]);
    setWordpressActionState('idle');
    setWordpressError(null);
    setWordpressWarnings([]);
    setSiteActionState('idle');
    setSiteCommitUrl(null);
  }, [routeScope, updateRetryRequest]);

  useEffect(() => {
    if (
      retryRequest.phase !== 'awaiting_authoritative' ||
      !retryScope ||
      !articlePublishingStateVersion
    ) {
      return;
    }

    const next = reconcileAutoPublishRetry(
      retryRequestRef.current,
      retryScope,
      articlePublishingStateVersion,
    );
    if (next !== retryRequestRef.current) updateRetryRequest(next);
  }, [articlePublishingStateVersion, retryRequest.phase, retryScope, updateRetryRequest]);

  useEffect(() => {
    if (!article || !routeScope) return;

    setManualRefreshTargets((current) => {
      const next = current.filter(
        (target) => target.scope !== routeScope || !hasObservedManualPublishTarget(article, target),
      );
      return next.length === current.length ? current : next;
    });
  }, [article, routeScope]);

  // A reload or tab close is the one exit the in-app guards below cannot catch.
  useEffect(() => {
    if (!dirty) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  const connectedIntegrationsQuery = useConnectedIntegrations(organization?.id ?? null, {
    enabled: !redirecting && !organizationLoading,
    onUnauthorized: handleUnauthorized,
  });
  const wordpressConnected = connectedIntegrationsQuery.data
    ? connectedIntegrationsQuery.data.integrations.some(
        (integration) => integration.provider === 'wordpress',
      )
    : undefined;
  const staticSiteConnected = connectedIntegrationsQuery.data
    ? connectedIntegrationsQuery.data.integrations.some(
        (integration) => integration.provider === 'static-site',
      )
    : undefined;
  // One button per connected target. Until anything is connected we still show
  // the WordPress one — disabled, with the hint that has always been there,
  // which is how someone discovers publishing exists at all.
  const showSiteButton = staticSiteConnected === true;
  const showWordPressButton = wordpressConnected !== false || !showSiteButton;
  const wordpressRefreshPending = manualRefreshTargets.some(
    (target) => target.scope === routeScope && target.provider === 'wordpress',
  );
  const siteRefreshPending = manualRefreshTargets.some(
    (target) => target.scope === routeScope && target.provider === 'static-site',
  );

  const refreshPublishingState = useCallback(async () => {
    if (!organization || !articleId) return;

    await Promise.all([
      queryClient.invalidateQueries({
        exact: true,
        queryKey: dashboardQueryKeys.articleDetail(organization.id, articleId),
      }),
      queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.articleLists(organization.id),
      }),
    ]);
  }, [articleId, organization, queryClient]);

  const loadState: ArticleLoadState = !articleId
    ? 'not_found'
    : redirecting || organizationLoading
      ? 'loading'
      : organizationError || !organization
        ? 'error'
        : editor.isPending
          ? 'loading'
          : editor.isError
            ? 'error'
            : article
              ? 'ready'
              : 'not_found';

  async function syncWordPressArticle() {
    if (
      !article ||
      !routeScope ||
      publishBlocked ||
      wordpressRefreshPending ||
      wordpressActionState === 'loading'
    ) {
      return;
    }

    const isUpdate = Boolean(article.wordpress_post_id);
    const scope = routeScope;

    setWordpressActionState('loading');
    setWordpressError((current) => reduceManualWordPressError(current, { type: 'started' }));
    setWordpressWarnings([]);

    try {
      const endpoint = api.api.v0.dashboard.articles[':id'].wordpress;
      const response = isUpdate
        ? await endpoint.$put({ param: { id: article.id } })
        : await endpoint.$post({ param: { id: article.id } });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        if (activeScopeRef.current !== scope) return;
        setWordpressError((current) =>
          reduceManualWordPressError(current, { body: data, type: 'failed' }),
        );
        setWordpressActionState('error');
        return;
      }

      if (!('post_id' in data)) {
        throw new Error('wordpress_response_invalid');
      }

      if (activeScopeRef.current !== scope) {
        await refreshPublishingState().catch(() => {});
        return;
      }
      setWordpressError((current) => reduceManualWordPressError(current, { type: 'succeeded' }));
      setWordpressWarnings(data.warnings ?? []);
      setWordpressActionState(isUpdate ? 'updated' : 'published');
      setManualRefreshTargets((current) => [
        ...current.filter((target) => target.scope !== scope || target.provider !== 'wordpress'),
        { provider: 'wordpress', ref: String(data.post_id), scope },
      ]);
      await refreshPublishingState().catch(() => {});
    } catch (error) {
      if (activeScopeRef.current !== scope) return;
      setWordpressError((current) =>
        reduceManualWordPressError(current, { body: error, type: 'failed' }),
      );
      setWordpressActionState('error');
    }
  }

  async function publishToSite() {
    if (
      !article ||
      !routeScope ||
      publishBlocked ||
      siteRefreshPending ||
      siteActionState === 'loading'
    ) {
      return;
    }

    const scope = routeScope;
    setSiteActionState('loading');
    setSiteCommitUrl(null);

    try {
      const response = await api.api.v0.dashboard.articles[':id'].publish.$post({
        param: { id: article.id },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        if (activeScopeRef.current !== scope) return;
        const code = 'code' in data && typeof data.code === 'string' ? data.code : null;
        setSiteErrorKey((code && SITE_ERROR_KEYS[code]) || 'failed');
        setSiteActionState('error');
        return;
      }

      if (!('commit_sha' in data)) {
        throw new Error('publish_response_invalid');
      }

      if (activeScopeRef.current !== scope) {
        await refreshPublishingState().catch(() => {});
        return;
      }
      setSiteCommitUrl(getSafePublicationUrl(data.commit_url));
      setSiteActionState('published');
      setManualRefreshTargets((current) => [
        ...current.filter((target) => target.scope !== scope || target.provider !== 'static-site'),
        { provider: 'static-site', ref: data.commit_sha, scope },
      ]);
      await refreshPublishingState().catch(() => {});
    } catch {
      if (activeScopeRef.current !== scope) return;
      setSiteErrorKey('failed');
      setSiteActionState('error');
    }
  }

  async function retryAutoPublish() {
    if (!article || !organization || !retryScope || !articlePublishingStateVersion) return;

    const scope = retryScope;
    const started = beginAutoPublishRetry(retryRequestRef.current, {
      publishBlocked,
      publishingStateVersion: articlePublishingStateVersion,
      retryAvailable,
      scope,
    });
    if (started.state !== retryRequestRef.current) updateRetryRequest(started.state);
    if (!started.shouldSubmit) return;

    try {
      const response = await api.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post({
        param: { id: article.id },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        const code =
          'code' in data && typeof data.code === 'string'
            ? data.code
            : (response.status as number) === 404
              ? 'article_not_found'
              : 'unknown';
        const failed = failAutoPublishRetryRequest(
          retryRequestRef.current,
          scope,
          getPublishingErrorPresentation(code),
        );
        if (failed !== retryRequestRef.current) updateRetryRequest(failed);
        return;
      }

      if (!('queued' in data)) {
        throw new Error('retry_response_invalid');
      }

      const completed = completeAutoPublishRetryRequest(
        retryRequestRef.current,
        scope,
        getAutoPublishRetryResult(data.queued),
      );
      if (completed !== retryRequestRef.current) updateRetryRequest(completed);
      await refreshPublishingState().catch(() => {});
    } catch {
      const failed = failAutoPublishRetryRequest(
        retryRequestRef.current,
        scope,
        getPublishingErrorPresentation('unknown'),
      );
      if (failed !== retryRequestRef.current) updateRetryRequest(failed);
    }
  }

  const statusMessage =
    loadState === 'loading'
      ? t('status.loading')
      : loadState === 'not_found'
        ? t('status.notFound')
        : loadState === 'error'
          ? t('status.loadError')
          : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button asChild variant="link" className="mb-2 text-muted-foreground">
            <Link
              href="/content-history"
              // Leaving the route would drop the draft; the editor's own
              // confirmation banner asks first.
              onClick={(event) => {
                if (!dirty) return;
                event.preventDefault();
                requestClose();
              }}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('actions.back')}
            </Link>
          </Button>
          <PageTitle>{article?.title ?? t('title')}</PageTitle>
          {article?.meta_description ? (
            <PageDescription className="max-w-3xl">{article.meta_description}</PageDescription>
          ) : null}
        </div>
        {article ? (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <ArticleStatusBadge status={article.status} t={t} />
              {article.wordpress_post_id ? (
                <Badge variant="secondary" className="w-fit border-transparent">
                  {t('wordpress.sentBadge', { id: article.wordpress_post_id })}
                </Badge>
              ) : null}
              {article.static_site_published_at ? (
                <Badge variant="secondary" className="w-fit border-transparent">
                  {t('site.publishedBadge', {
                    date: formatDate(article.static_site_published_at, dateFormatter),
                  })}
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!editing && draftArticle ? (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  {t('actions.edit')}
                </Button>
              ) : null}
              {showSiteButton ? (
                <Button
                  onClick={publishToSite}
                  disabled={publishBlocked || siteActionState === 'loading' || siteRefreshPending}
                >
                  {siteActionState === 'loading' || siteRefreshPending
                    ? t(
                        article.static_site_published_at
                          ? 'actions.updatingSite'
                          : 'actions.publishingSite',
                      )
                    : t(
                        article.static_site_published_at
                          ? 'actions.updateSite'
                          : 'actions.publishSite',
                      )}
                </Button>
              ) : null}
              {showWordPressButton ? (
                <Button
                  onClick={syncWordPressArticle}
                  variant={showSiteButton ? 'outline' : 'default'}
                  disabled={
                    publishBlocked ||
                    wordpressActionState === 'loading' ||
                    wordpressRefreshPending ||
                    wordpressConnected === false
                  }
                >
                  {wordpressActionState === 'loading' || wordpressRefreshPending
                    ? t(
                        article.wordpress_post_id
                          ? 'actions.updatingWordPress'
                          : 'actions.publishingWordPress',
                      )
                    : t(
                        article.wordpress_post_id
                          ? 'actions.updateWordPress'
                          : 'actions.publishWordPress',
                      )}
                </Button>
              ) : null}
            </div>
            {publishBlocked && (showSiteButton || showWordPressButton) ? (
              <p className="text-muted-foreground text-xs">{t('status.editingBlocksPublish')}</p>
            ) : null}
            {!publishBlocked && showWordPressButton && wordpressConnected === false ? (
              <p className="text-muted-foreground text-xs">
                {t.rich('wordpress.connectFirst', {
                  link: (chunks) => (
                    <Link className="underline" href="/settings?tab=integrations">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {statusMessage ? <EmptyState framed>{statusMessage}</EmptyState> : null}

      {siteActionState === 'published' ? (
        <StatusPanel tone="success">
          <span>{t('site.published')}</span>
          {siteCommitUrl ? (
            <>
              {' '}
              <a
                className="underline"
                href={siteCommitUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {t('site.viewCommit')}
              </a>
            </>
          ) : null}
        </StatusPanel>
      ) : null}
      {siteActionState === 'error' ? (
        <StatusPanel tone="error">{t(`site.errors.${siteErrorKey}`)}</StatusPanel>
      ) : null}

      {wordpressActionState === 'published' ? (
        <StatusPanel tone="success">{t('wordpress.published')}</StatusPanel>
      ) : null}
      {wordpressActionState === 'updated' ? (
        <StatusPanel tone="success">{t('wordpress.updated')}</StatusPanel>
      ) : null}
      {wordpressActionState === 'error' ? (
        <StatusPanel tone="error">
          {wordpressError?.kind === 'plugin'
            ? t('wordpress.pluginError', { error: wordpressError.error })
            : t('wordpress.requestError')}
        </StatusPanel>
      ) : null}
      {wordpressWarnings.length > 0 ? (
        <StatusPanel tone="warning">
          <p className="font-medium">{t('wordpress.warnings')}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {wordpressWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </StatusPanel>
      ) : null}

      {article && autoPublishAggregate ? (
        <AutomaticPublishingPanel
          aggregate={autoPublishAggregate}
          article={article}
          dateTimeFormatter={dateTimeFormatter}
          onRetry={retryAutoPublish}
          publishBlocked={publishBlocked}
          providerStates={providerPublishingStates}
          retryAvailable={retryAvailable}
          retryFeedback={retryFeedback}
          retryPhase={retryPhase}
          t={t}
        />
      ) : null}

      {editing && article && draftArticle ? (
        <section
          aria-labelledby={ARTICLE_EDITOR_TITLE_ID}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <ArticleEditorPanel
            canSave={editor.canSave}
            context={
              <dl className="grid gap-3 text-sm">
                <ArticleEditorDetailItem label={t('labels.keyword')} value={article.keyword} />
                <ArticleEditorDetailItem
                  label={t('labels.createdAt')}
                  value={formatDate(article.created_at, dateFormatter)}
                />
                <ArticleEditorDetailItem
                  label={t('labels.publishedAt')}
                  value={
                    article.published_at
                      ? formatDate(article.published_at, dateFormatter)
                      : t('labels.notPublished')
                  }
                />
              </dl>
            }
            dirty={dirty}
            draftArticle={draftArticle}
            headerActions={
              <Button type="button" size="sm" variant="outline" onClick={requestClose}>
                {t('actions.cancelEdit')}
              </Button>
            }
            onContinueEditing={editor.continueEditing}
            onDiscardAndClose={editor.discardAndClose}
            onSave={editor.saveArticle}
            onUpdateDraftField={editor.updateDraftField}
            saveError={editor.saveError}
            saveState={editor.saveState}
            serverInvalidFields={editor.serverInvalidFields}
            showCloseConfirmation={editor.showCloseConfirmation}
            updatedAtLabel={editorT('status.updatedAt', {
              date: formatDate(draftArticle.updatedAt ?? draftArticle.createdAt, dateTimeFormatter),
            })}
            validation={editor.validation}
          />
        </section>
      ) : article ? (
        <section className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:p-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem label={t('labels.slug')} value={article.slug} />
            <DetailItem label={t('labels.keywordId')} value={article.keyword_id} />
            <DetailItem
              label={t('labels.createdAt')}
              value={formatDate(article.created_at, dateFormatter)}
            />
            <DetailItem
              label={t('labels.publishedAt')}
              value={
                article.published_at
                  ? formatDate(article.published_at, dateFormatter)
                  : t('labels.notPublished')
              }
            />
          </dl>

          <Separator />

          {article.featured_image_url ? (
            <Image
              src={article.featured_image_url}
              alt=""
              width={1280}
              height={720}
              unoptimized
              className="aspect-video w-full rounded-md border border-border object-cover"
            />
          ) : null}

          <ArticleContentPreview content={article.content} />
        </section>
      ) : null}
    </div>
  );
}

function AutomaticPublishingPanel({
  aggregate,
  article,
  dateTimeFormatter,
  onRetry,
  publishBlocked,
  providerStates,
  retryAvailable,
  retryFeedback,
  retryPhase,
  t,
}: {
  aggregate: ReturnType<typeof getAutoPublishAggregateState>;
  article: ArticleDetailResponse;
  dateTimeFormatter: Intl.DateTimeFormat;
  onRetry: () => void;
  publishBlocked: boolean;
  providerStates: ProviderPublishingState[];
  retryAvailable: boolean;
  retryFeedback: AutoPublishRetryState['feedback'];
  retryPhase: AutoPublishRetryState['phase'];
  t: ReturnType<typeof useTranslations<'ArticleDetailPage'>>;
}) {
  const aggregateLabel = t(AUTO_PUBLISH_STATUS_KEYS[aggregate.status]);
  const retryLocked = retryPhase !== 'idle';

  return (
    <section
      aria-labelledby="automatic-publishing-title"
      className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="automatic-publishing-title" className="font-semibold text-foreground text-base">
            {t('publishing.title')}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{t('publishing.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AutoPublishAggregateBadge status={aggregate.status} label={aggregateLabel} />
          {retryAvailable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('publishing.retry.accessibleLabel')}
              aria-describedby={publishBlocked ? 'automatic-publishing-retry-blocked' : undefined}
              disabled={publishBlocked || retryLocked}
              onClick={onRetry}
            >
              <RotateCcw
                className={cn('size-4', retryLocked && 'animate-spin')}
                aria-hidden="true"
              />
              {t(
                retryPhase === 'submitting'
                  ? 'publishing.retry.submitting'
                  : retryPhase === 'awaiting_authoritative'
                    ? 'publishing.retry.refreshing'
                    : 'publishing.retry.button',
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {retryAvailable && publishBlocked ? (
        <p id="automatic-publishing-retry-blocked" className="text-muted-foreground text-sm">
          {t('publishing.retry.editingBlocked')}
        </p>
      ) : null}

      {retryFeedback?.kind === 'queued' ? (
        <StatusPanel tone="success">
          {t('publishing.retry.queued', {
            providers: formatProviderList(
              retryFeedback.providers,
              dateTimeFormatter.resolvedOptions().locale,
              t,
            ),
          })}
        </StatusPanel>
      ) : null}
      {retryFeedback?.kind === 'already_published' ? (
        <StatusPanel tone="success">{t('publishing.retry.alreadyPublished')}</StatusPanel>
      ) : null}
      {retryFeedback?.kind === 'error' ? (
        <StatusPanel tone="error">
          <LocalizedPublishingError error={retryFeedback.error} t={t} />
        </StatusPanel>
      ) : null}

      {article.auto_publish_error ? (
        <StatusPanel role="alert" tone="error">
          <h3 className="font-medium">{t('publishing.preflightError')}</h3>
          <div className="mt-1">
            <LocalizedPublishingError
              error={getPublishingErrorPresentation(article.auto_publish_error.code)}
              t={t}
            />
          </div>
          <p className="mt-1 text-error text-xs">
            {t('publishing.errorAt', {
              date: formatDate(article.auto_publish_error.at, dateTimeFormatter),
            })}
          </p>
        </StatusPanel>
      ) : null}

      {aggregate.partialSuccess ? (
        <StatusPanel tone="warning">{t('publishing.partialSuccess')}</StatusPanel>
      ) : null}

      {providerStates.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {providerStates.map((providerState) => (
            <ProviderPublishingCard
              key={providerState.provider}
              dateTimeFormatter={dateTimeFormatter}
              state={providerState}
              t={t}
            />
          ))}
        </div>
      ) : article.auto_publish_error ? null : (
        <div className="rounded-md border border-border bg-muted/50 px-4 py-4 text-muted-foreground text-sm">
          <p>{t('publishing.empty')}</p>
          <Link
            href="/article-settings"
            className="mt-2 inline-flex font-medium text-foreground underline underline-offset-2"
          >
            {t('publishing.settingsLink')}
          </Link>
        </div>
      )}
    </section>
  );
}

function AutoPublishAggregateBadge({
  label,
  status,
}: {
  label: string;
  status: AutoPublishAggregateStatus;
}) {
  return (
    <Badge variant={AUTO_PUBLISH_BADGE_VARIANTS[status]} className="w-fit">
      {label}
    </Badge>
  );
}

function ProviderPublishingCard({
  dateTimeFormatter,
  state,
  t,
}: {
  dateTimeFormatter: Intl.DateTimeFormat;
  state: ProviderPublishingState;
  t: ReturnType<typeof useTranslations<'ArticleDetailPage'>>;
}) {
  const { attempt, provider, publication } = state;
  const remoteUrl = getSafePublicationUrl(publication?.remote_url ?? null);

  return (
    <article className="grid min-w-0 gap-3 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-foreground">{t(`publishing.providers.${provider}`)}</h3>
        <AttemptStatusBadge attempt={attempt} hasPublication={Boolean(publication)} t={t} />
      </header>

      {attempt ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <PublishingDetail
            label={t('publishing.labels.attemptCount')}
            value={t('publishing.attemptCount', { count: attempt.attempt_count })}
          />
          <PublishingDateDetail
            dateTime={attempt.requested_at}
            formatter={dateTimeFormatter}
            label={t('publishing.labels.requestedAt')}
          />
          {attempt.last_attempt_at ? (
            <PublishingDateDetail
              dateTime={attempt.last_attempt_at}
              formatter={dateTimeFormatter}
              label={t('publishing.labels.lastAttemptAt')}
            />
          ) : null}
        </dl>
      ) : null}

      {attempt?.last_error ? (
        <div
          role="alert"
          className="rounded-md border border-error-border bg-error-subtle px-3 py-2 text-error text-sm"
        >
          <p className="font-medium">{t('publishing.lastError')}</p>
          <LocalizedPublishingError
            error={getPublishingErrorPresentation(attempt.last_error.code)}
            t={t}
          />
          <p className="mt-1 text-error text-xs">
            {t('publishing.errorAt', {
              date: formatDate(attempt.last_error.at, dateTimeFormatter),
            })}
          </p>
        </div>
      ) : null}

      {publication ? (
        <div className="grid gap-3 border-border border-t pt-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <PublishingDetail label={t('publishing.labels.slug')} value={publication.slug} />
            <PublishingDateDetail
              dateTime={publication.published_at}
              formatter={dateTimeFormatter}
              label={t('publishing.labels.publishedAt')}
            />
            {publication.updated_at ? (
              <PublishingDateDetail
                dateTime={publication.updated_at}
                formatter={dateTimeFormatter}
                label={t('publishing.labels.updatedAt')}
              />
            ) : (
              <PublishingDetail
                label={t('publishing.labels.updatedAt')}
                value={t('publishing.notUpdated')}
              />
            )}
          </dl>
          {remoteUrl ? (
            <a
              className="inline-flex w-fit items-center gap-1.5 font-medium text-foreground text-sm underline underline-offset-2"
              href={remoteUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t(
                provider === 'wordpress'
                  ? 'publishing.links.wordpress'
                  : 'publishing.links.static-site',
              )}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function AttemptStatusBadge({
  attempt,
  hasPublication,
  t,
}: {
  attempt: AutoPublishAttempt | null;
  hasPublication: boolean;
  t: ReturnType<typeof useTranslations<'ArticleDetailPage'>>;
}) {
  const label = attempt
    ? t(ATTEMPT_STATUS_KEYS[attempt.status])
    : hasPublication
      ? t('publishing.attemptStatuses.manual')
      : t('publishing.statuses.notQueued');

  return (
    <Badge
      variant={
        attempt ? ATTEMPT_BADGE_VARIANTS[attempt.status] : hasPublication ? 'success' : 'neutral'
      }
      className="w-fit"
    >
      {label}
    </Badge>
  );
}

function PublishingDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}

function PublishingDateDetail({
  dateTime,
  formatter,
  label,
}: {
  dateTime: string;
  formatter: Intl.DateTimeFormat;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">
        <time dateTime={dateTime}>{formatDate(dateTime, formatter)}</time>
      </dd>
    </div>
  );
}

function LocalizedPublishingError({
  error,
  t,
}: {
  error: PublishingErrorPresentation;
  t: ReturnType<typeof useTranslations<'ArticleDetailPage'>>;
}) {
  return (
    <>
      <span>{t(error.messageKey)}</span>
      <PublishingErrorActionLink action={error.action} t={t} />
    </>
  );
}

function PublishingErrorActionLink({
  action,
  t,
}: {
  action: PublishingErrorAction;
  t: ReturnType<typeof useTranslations<'ArticleDetailPage'>>;
}) {
  if (!action || action === 'edit_slug') return null;

  const destination = {
    article_settings: {
      href: '/article-settings',
      key: 'publishing.actions.articleSettings',
    },
    billing: {
      href: '/billing',
      key: 'publishing.actions.billing',
    },
    integrations: {
      href: '/settings?tab=integrations',
      key: 'publishing.actions.integrations',
    },
    wordpress_docs: {
      href: '/docs/wordpress',
      key: 'publishing.actions.wordpressDocs',
    },
  } as const;
  const target = destination[action];

  return (
    <>
      {' '}
      <Link className="font-medium underline underline-offset-2" href={target.href}>
        {t(target.key)}
      </Link>
    </>
  );
}

function formatProviderList(
  providers: PublishingProvider[],
  locale: string,
  t: ReturnType<typeof useTranslations<'ArticleDetailPage'>>,
) {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    providers.map((provider) => t(`publishing.providers.${provider}`)),
  );
}

function ArticleStatusBadge({
  status,
  t,
}: {
  status: ArticleStatus;
  t: ReturnType<typeof useTranslations<'ArticleDetailPage'>>;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'w-fit border-transparent',
        status === 'published'
          ? 'bg-success-muted text-success'
          : status === 'generated'
            ? 'bg-info-muted text-info'
            : 'bg-muted text-foreground',
      )}
    >
      {t(`statuses.${status}`)}
    </Badge>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}

function formatDate(value: string, formatter: Intl.DateTimeFormat) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
