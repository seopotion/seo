'use client';

import { ArrowLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Separator } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
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
};

type ArticleLoadState = 'error' | 'loading' | 'not_found' | 'ready';

export default function ArticleDetailPage() {
  const t = useTranslations('ArticleDetailPage');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ articleId?: string | string[] }>();
  const articleId = Array.isArray(params.articleId) ? params.articleId[0] : params.articleId;
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loadState, setLoadState] = useState<ArticleLoadState>('loading');

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const handleUnauthorized = useCallback(() => {
    clearToken();
    clearWorkspaceStatusCache();
    router.replace('/');
  }, [router]);

  useEffect(() => {
    if (!articleId) {
      setArticle(null);
      setLoadState('not_found');
      return;
    }

    let cancelled = false;

    setArticle(null);
    setLoadState('loading');

    void (async () => {
      try {
        const response = await api.api.v0.dashboard.articles[':id'].$get({
          param: { id: articleId },
        });

        if (cancelled) return;

        if ((response.status as number) === 401) {
          handleUnauthorized();
          return;
        }

        if ((response.status as number) === 404) {
          setLoadState('not_found');
          return;
        }

        if (!response.ok) {
          throw new Error('article_load_failed');
        }

        const data = await response.json();

        if (!cancelled) {
          setArticle(data);
          setLoadState('ready');
        }
      } catch {
        if (!cancelled) {
          setLoadState('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [articleId, handleUnauthorized]);

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
        {article ? <ArticleStatusBadge status={article.status} t={t} /> : null}
      </div>

      {statusMessage ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-slate-600 text-sm">
          {statusMessage}
        </div>
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
