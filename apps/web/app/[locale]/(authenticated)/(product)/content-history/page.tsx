'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardContent, Separator } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import {
  type ArticlePublishingState,
  type AutoPublishAggregateStatus,
  getAutoPublishAggregateState,
  hasActiveAutoPublishAttempts,
} from '@/lib/auto-publishing';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';

type ArticleListStatus = 'generated' | 'published' | 'deleted';

type ArticleListItemResponse = ArticlePublishingState & {
  created_at: string;
  difficulty: number;
  id: string;
  keyword: string;
  published_at: string | null;
  search_volume: number;
  status: ArticleListStatus;
  title: string;
};

type PublishedArticle = ArticlePublishingState & {
  difficulty: number;
  id: string;
  keyword: string;
  publishedAt: string;
  status: ArticleListStatus;
  title: string;
  volume: number;
};

type ContentHistoryData = {
  articles: PublishedArticle[];
  total: number;
};

const ARTICLES_PER_PAGE = 20;
const emptyContentHistoryData: ContentHistoryData = {
  articles: [],
  total: 0,
};

const AUTO_PUBLISH_STATUS_KEYS = {
  needs_attention: 'autoPublishing.statuses.needsAttention',
  not_queued: 'autoPublishing.statuses.notQueued',
  published: 'autoPublishing.statuses.published',
  publishing: 'autoPublishing.statuses.publishing',
  queued: 'autoPublishing.statuses.queued',
  retrying: 'autoPublishing.statuses.retrying',
} as const satisfies Record<AutoPublishAggregateStatus, string>;

export default function ContentHistoryPage() {
  const t = useTranslations('ContentHistoryPage');
  const locale = useLocale();
  const router = useRouter();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const [page, setPage] = useState(1);
  const [redirecting, setRedirecting] = useState(false);
  const queryClient = useQueryClient();
  const offset = (page - 1) * ARTICLES_PER_PAGE;

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const historyQuery = useQuery({
    queryKey: dashboardQueryKeys.articleList(
      organization?.id ?? '',
      'all',
      ARTICLES_PER_PAGE,
      offset,
    ),
    queryFn: async (): Promise<ContentHistoryData> => {
      if (!organization) return emptyContentHistoryData;

      // Deliberately unfiltered. Filtering to `status: 'published'` left every
      // generated-but-not-yet-published article with no route into it at all —
      // Content Planner only links what is on the plan, so with an empty plan
      // the article was reachable only by typing its id into the URL. The row
      // already carries a status badge, which is the honest way to show the
      // difference. `'deleted'` is unreachable today (nothing writes it).
      const response = await api.api.v0.dashboard.articles.$get({
        query: {
          org_id: organization.id,
          limit: ARTICLES_PER_PAGE,
          offset,
        },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        return emptyContentHistoryData;
      }

      if (!response.ok) {
        throw new Error('articles_load_failed');
      }

      const data = await response.json();

      return {
        articles: mapArticleRows(data.articles),
        total: data.total,
      };
    },
    enabled: !redirecting && !organizationLoading && Boolean(organization),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.articles.some((article) =>
        hasActiveAutoPublishAttempts(article.auto_publish_attempts),
      )
        ? 4_000
        : false,
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    if (!historyQuery.data || historyQuery.isError || historyQuery.isPlaceholderData) return;

    const responseTotalPages = getTotalPages(historyQuery.data.total);

    if (page > responseTotalPages) {
      setPage(responseTotalPages);
    }
  }, [historyQuery.data, historyQuery.isError, historyQuery.isPlaceholderData, page]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );
  const data = historyQuery.isError ? emptyContentHistoryData : historyQuery.data;
  const articles = data?.articles ?? emptyContentHistoryData.articles;
  const totalArticles = data?.total ?? emptyContentHistoryData.total;
  const loadError = historyQuery.isError;
  const loading =
    redirecting || organizationLoading || (Boolean(organization) && historyQuery.isPending);
  const totalPages = getTotalPages(totalArticles);
  const currentPage = Math.min(page, totalPages);
  const startIndex = totalArticles === 0 ? 0 : (currentPage - 1) * ARTICLES_PER_PAGE;
  const endIndex = totalArticles === 0 ? 0 : startIndex + articles.length;
  const rangeLabel =
    totalArticles === 0
      ? t('pagination.emptyRange')
      : t('pagination.range', {
          end: endIndex,
          start: startIndex + 1,
          total: totalArticles,
        });
  const statusMessage = getHistoryStatusMessage({
    loadError,
    loading,
    organizationError,
    t,
  });

  return (
    <div className="grid gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-semibold text-lg text-slate-950">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-slate-600 text-sm">{t('description')}</p>
        </div>
        <Badge variant="secondary" className="w-fit bg-slate-200 text-slate-700">
          {t('articlesCount', { count: totalArticles })}
        </Badge>
      </header>

      <section
        aria-label={t('tableLabel')}
        className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block"
      >
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(9rem,0.8fr)_6rem_5rem_minmax(9rem,0.7fr)_7rem] border-slate-200 border-b bg-slate-50 px-4 py-2 font-semibold text-slate-600 text-xs">
          <span>{t('columns.articleName')}</span>
          <span>{t('columns.keyword')}</span>
          <span>{t('columns.volume')}</span>
          <span>{t('columns.difficulty')}</span>
          <span>{t('columns.status')}</span>
          <span>{t('columns.publishDate')}</span>
        </div>

        {statusMessage ? (
          <StatusState message={statusMessage} />
        ) : articles.length > 0 ? (
          <div className="divide-y divide-slate-200">
            {articles.map((article) => (
              <DesktopArticleRow
                key={article.id}
                article={article}
                dateFormatter={dateFormatter}
                locale={locale}
                t={t}
              />
            ))}
          </div>
        ) : (
          <EmptyState t={t} />
        )}
      </section>

      <section aria-label={t('listLabel')} className="grid gap-2 md:hidden">
        {statusMessage ? (
          <StatusState message={statusMessage} framed />
        ) : articles.length > 0 ? (
          articles.map((article) => (
            <MobileArticleCard
              key={article.id}
              article={article}
              dateFormatter={dateFormatter}
              locale={locale}
              t={t}
            />
          ))
        ) : (
          <EmptyState t={t} framed />
        )}
      </section>

      <PaginationControls
        currentPage={currentPage}
        disabled={totalArticles === 0 || Boolean(statusMessage)}
        pageSize={ARTICLES_PER_PAGE}
        rangeLabel={rangeLabel}
        setPage={setPage}
        totalPages={totalPages}
        t={t}
      />
    </div>
  );
}

function DesktopArticleRow({
  article,
  dateFormatter,
  locale,
  t,
}: {
  article: PublishedArticle;
  dateFormatter: Intl.DateTimeFormat;
  locale: string;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  const publishedDate = formatPublishedDate(article.publishedAt, dateFormatter);
  const rowClassName =
    'grid min-h-14 grid-cols-[minmax(0,1.4fr)_minmax(9rem,0.8fr)_6rem_5rem_minmax(9rem,0.7fr)_7rem] items-center gap-0 px-4 py-3 text-sm';

  return (
    <Link
      href={`/content-history/${article.id}`}
      aria-label={t('actions.openArticle', { title: article.title })}
      className={cn(
        rowClassName,
        'text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
    >
      <ArticleName title={article.title} linked />
      <span className="min-w-0 truncate px-3 text-slate-600">{article.keyword}</span>
      <span className="min-w-0 truncate text-slate-600">
        {formatNumber(article.volume, locale)}
      </span>
      <span className="min-w-0 truncate text-slate-600">
        {formatNumber(article.difficulty, locale)}
      </span>
      <span className="grid min-w-0 gap-1 pr-2">
        <StatusBadge status={article.status} t={t} />
        <AutoPublishStatusIndicator article={article} t={t} />
      </span>
      <time dateTime={article.publishedAt} className="min-w-0 truncate text-slate-600">
        {publishedDate}
      </time>
    </Link>
  );
}

function MobileArticleCard({
  article,
  dateFormatter,
  locale,
  t,
}: {
  article: PublishedArticle;
  dateFormatter: Intl.DateTimeFormat;
  locale: string;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  const publishedDate = formatPublishedDate(article.publishedAt, dateFormatter);

  return (
    <Link
      href={`/content-history/${article.id}`}
      aria-label={t('actions.openArticle', { title: article.title })}
      className="block rounded-lg transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="gap-3 border-slate-200 py-4 shadow-none">
        <CardContent className="grid gap-3 px-4">
          <div className="grid gap-2">
            <ArticleName title={article.title} linked />
            <div className="flex flex-wrap items-start gap-2">
              <StatusBadge status={article.status} t={t} />
              <AutoPublishStatusIndicator article={article} t={t} />
            </div>
          </div>
          <Separator />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-slate-500 text-xs">{t('columns.keyword')}</dt>
              <dd className="mt-1 truncate font-medium text-slate-700">{article.keyword}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500 text-xs">{t('columns.volume')}</dt>
              <dd className="mt-1 truncate font-medium text-slate-700">
                {formatNumber(article.volume, locale)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500 text-xs">{t('columns.difficulty')}</dt>
              <dd className="mt-1 truncate font-medium text-slate-700">
                {formatNumber(article.difficulty, locale)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500 text-xs">{t('columns.publishDate')}</dt>
              <dd className="mt-1 truncate font-medium text-slate-700">
                <time dateTime={article.publishedAt}>{publishedDate}</time>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}

function ArticleName({ linked = false, title }: { linked?: boolean; title: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 pr-3">
      <span className="min-w-0 truncate font-medium text-slate-950">{title}</span>
      {linked ? <FileText className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" /> : null}
    </span>
  );
}

/**
 * The list is no longer filtered to published articles, so the row has to say
 * which state it is in — otherwise a generated draft and a live article are
 * indistinguishable. Same colours as the badge on the article detail page.
 */
function StatusBadge({
  status,
  t,
}: {
  status: ArticleListStatus;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'w-fit border-transparent',
        status === 'published'
          ? 'bg-emerald-100 text-emerald-700'
          : status === 'generated'
            ? 'bg-sky-100 text-sky-700'
            : 'bg-slate-200 text-slate-700',
      )}
    >
      {t(`articleStatuses.${status}`)}
    </Badge>
  );
}

function AutoPublishStatusIndicator({
  article,
  t,
}: {
  article: PublishedArticle;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  const aggregate = getAutoPublishAggregateState({
    autoPublishError: article.auto_publish_error,
    attempts: article.auto_publish_attempts,
    publications: article.publications,
  });
  const status = t(AUTO_PUBLISH_STATUS_KEYS[aggregate.status]);

  return (
    <span className="grid w-fit gap-0.5">
      <Badge
        variant="secondary"
        aria-label={t('autoPublishing.label', { status })}
        className={cn(
          'h-auto w-fit max-w-full whitespace-normal border-transparent px-2 py-0.5 text-left text-xs',
          aggregate.status === 'needs_attention'
            ? 'bg-red-100 text-red-700'
            : aggregate.status === 'retrying'
              ? 'bg-amber-100 text-amber-800'
              : aggregate.status === 'publishing'
                ? 'bg-violet-100 text-violet-700'
                : aggregate.status === 'queued'
                  ? 'bg-sky-100 text-sky-700'
                  : aggregate.status === 'published'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600',
        )}
      >
        {t('autoPublishing.shortLabel', { status })}
      </Badge>
      {aggregate.partialSuccess ? (
        <span className="text-slate-500 text-xs">{t('autoPublishing.partialSuccess')}</span>
      ) : null}
    </span>
  );
}

function EmptyState({
  framed = false,
  t,
}: {
  framed?: boolean;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  return (
    <div
      className={cn(
        'grid place-items-center bg-white px-4 py-12',
        framed && 'rounded-lg border border-slate-200',
      )}
    >
      <div className="grid max-w-sm justify-items-center text-center">
        <span className="flex size-10 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Archive className="size-5" aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-semibold text-base text-slate-950">{t('empty.title')}</h2>
        <p className="mt-2 text-slate-600 text-sm leading-6">{t('empty.description')}</p>
      </div>
    </div>
  );
}

function StatusState({ framed = false, message }: { framed?: boolean; message: string }) {
  return (
    <div
      className={cn(
        'grid place-items-center bg-white px-4 py-12 text-center text-slate-600 text-sm',
        framed && 'rounded-lg border border-slate-200',
      )}
    >
      {message}
    </div>
  );
}

function PaginationControls({
  currentPage,
  disabled,
  pageSize,
  rangeLabel,
  setPage,
  totalPages,
  t,
}: {
  currentPage: number;
  disabled: boolean;
  pageSize: number;
  rangeLabel: string;
  setPage: (updater: (page: number) => number) => void;
  totalPages: number;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  const pageLabel = disabled
    ? t('pagination.emptyPage')
    : t('pagination.page', { page: currentPage, totalPages });

  return (
    <nav
      aria-label={t('pagination.label')}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="truncate text-slate-700 text-sm">{rangeLabel}</p>
        <p className="mt-0.5 truncate text-slate-500 text-xs">
          {t('pagination.perPage', { count: pageSize })}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full min-w-0 sm:w-auto sm:min-w-28"
          disabled={disabled || currentPage === 1}
          onClick={() => setPage((previousPage) => Math.max(1, previousPage - 1))}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t('pagination.previous')}
        </Button>
        <span className="min-w-20 text-center font-medium text-slate-600 text-sm">{pageLabel}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full min-w-0 sm:w-auto sm:min-w-28"
          disabled={disabled || currentPage === totalPages}
          onClick={() => setPage((previousPage) => Math.min(totalPages, previousPage + 1))}
        >
          {t('pagination.next')}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

function getHistoryStatusMessage({
  loadError,
  loading,
  organizationError,
  t,
}: {
  loadError: boolean;
  loading: boolean;
  organizationError: ReturnType<typeof useActiveOrganization>['error'];
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  if (loading) return t('status.loading');
  if (organizationError === 'no_organization') return t('status.noOrganization');
  if (organizationError) return t('status.organizationError');
  if (loadError) return t('status.loadError');
  return null;
}

function mapArticleRows(articles: ArticleListItemResponse[]): PublishedArticle[] {
  return articles.map((article) => ({
    auto_publish_attempts: article.auto_publish_attempts,
    auto_publish_error: article.auto_publish_error,
    difficulty: article.difficulty,
    id: article.id,
    keyword: article.keyword,
    publishedAt: article.published_at ?? article.created_at,
    publications: article.publications,
    status: article.status,
    title: article.title,
    volume: article.search_volume,
  }));
}

function getTotalPages(totalArticles: number) {
  return Math.max(1, Math.ceil(totalArticles / ARTICLES_PER_PAGE));
}

function formatPublishedDate(publishedAt: string, formatter: Intl.DateTimeFormat) {
  const date = new Date(publishedAt);

  return Number.isNaN(date.getTime()) ? publishedAt : formatter.format(date);
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}
