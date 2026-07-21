'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Badge, Button, Separator } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';

type ArticleStatus = 'generated' | 'published' | 'deleted';

type ArticleDetail = {
  content: string;
  created_at: string;
  featured_image_url: string;
  id: string;
  keyword_id: string;
  meta_description: string;
  published_at: string | null;
  slug: string;
  status: ArticleStatus;
  title: string;
  wordpress_post_id?: number;
};

type ArticleLoadState = 'error' | 'loading' | 'not_found' | 'ready';
type WordPressActionState = 'error' | 'idle' | 'loading' | 'published' | 'updated';

export default function ArticleDetailPage() {
  const t = useTranslations('ArticleDetailPage');
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
  const [wordpressActionState, setWordpressActionState] = useState<WordPressActionState>('idle');
  const [wordpressError, setWordpressError] = useState<string | null>(null);
  const [wordpressWarnings, setWordpressWarnings] = useState<string[]>([]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const articleQuery = useQuery({
    queryKey: dashboardQueryKeys.articleDetail(organization?.id ?? '', articleId ?? ''),
    queryFn: async (): Promise<ArticleDetail | null> => {
      if (!organization || !articleId) return null;

      const response = await api.api.v0.dashboard.articles[':id'].$get({
        param: { id: articleId },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        return null;
      }

      if ((response.status as number) === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error('article_load_failed');
      }

      return response.json();
    },
    enabled: !redirecting && !organizationLoading && Boolean(organization && articleId),
    staleTime: 60 * 60 * 1000,
  });

  const article = articleQuery.data ?? null;
  const loadState: ArticleLoadState = !articleId
    ? 'not_found'
    : redirecting || organizationLoading
      ? 'loading'
      : organizationError || !organization
        ? 'error'
        : articleQuery.isPending
          ? 'loading'
          : articleQuery.isError
            ? 'error'
            : article
              ? 'ready'
              : 'not_found';

  async function syncWordPressArticle() {
    if (!article || wordpressActionState === 'loading') return;

    const isUpdate = Boolean(article.wordpress_post_id);

    setWordpressActionState('loading');
    setWordpressError(null);
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
        setWordpressError('error' in data ? data.error : null);
        setWordpressActionState('error');
        return;
      }

      if (!('post_id' in data)) {
        throw new Error('wordpress_response_invalid');
      }

      queryClient.setQueryData<ArticleDetail | null>(
        dashboardQueryKeys.articleDetail(organization?.id ?? '', articleId ?? ''),
        (currentArticle) =>
          currentArticle ? { ...currentArticle, wordpress_post_id: data.post_id } : currentArticle,
      );
      setWordpressWarnings(data.warnings ?? []);
      setWordpressActionState(isUpdate ? 'updated' : 'published');
    } catch {
      setWordpressError(null);
      setWordpressActionState('error');
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
          <Button asChild variant="link" className="mb-2 text-slate-600">
            <Link href="/content-history">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('actions.back')}
            </Link>
          </Button>
          <h1 className="font-semibold text-lg text-slate-950">{article?.title ?? t('title')}</h1>
          {article?.meta_description ? (
            <p className="mt-1 max-w-3xl text-slate-600 text-sm">{article.meta_description}</p>
          ) : null}
        </div>
        {article ? (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <ArticleStatusBadge status={article.status} t={t} />
            <Button onClick={syncWordPressArticle} disabled={wordpressActionState === 'loading'}>
              {wordpressActionState === 'loading'
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
          </div>
        ) : null}
      </div>

      {statusMessage ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-slate-600 text-sm">
          {statusMessage}
        </div>
      ) : null}

      {wordpressActionState === 'published' ? (
        <WordPressStatus tone="success">{t('wordpress.published')}</WordPressStatus>
      ) : null}
      {wordpressActionState === 'updated' ? (
        <WordPressStatus tone="success">{t('wordpress.updated')}</WordPressStatus>
      ) : null}
      {wordpressActionState === 'error' ? (
        <WordPressStatus tone="error">
          {wordpressError
            ? t('wordpress.pluginError', { error: wordpressError })
            : t('wordpress.requestError')}
        </WordPressStatus>
      ) : null}
      {wordpressWarnings.length > 0 ? (
        <WordPressStatus tone="warning">
          <p className="font-medium">{t('wordpress.warnings')}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {wordpressWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </WordPressStatus>
      ) : null}

      {article ? (
        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
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

          <article className="whitespace-pre-wrap text-slate-700 text-sm leading-7">
            {article.content}
          </article>
        </section>
      ) : null}
    </div>
  );
}

function WordPressStatus({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'error' | 'success' | 'warning';
}) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      {children}
    </div>
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
          ? 'bg-emerald-100 text-emerald-700'
          : status === 'generated'
            ? 'bg-sky-100 text-sky-700'
            : 'bg-slate-200 text-slate-700',
      )}
    >
      {t(`statuses.${status}`)}
    </Badge>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500 text-xs">{label}</dt>
      <dd className="mt-1 truncate font-medium text-slate-950">{value}</dd>
    </div>
  );
}

function formatDate(value: string, formatter: Intl.DateTimeFormat) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
