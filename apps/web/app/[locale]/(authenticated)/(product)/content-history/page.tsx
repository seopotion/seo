'use client';

import { Archive, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, CardContent, Separator } from '@/components/ui';
import { cn } from '@/lib/utils';

type PublishedArticle = {
  id: string;
  title: string;
  keyword: string;
  publishedAt: string; // ISO date string
  contentUrl?: string;
};

const ARTICLES_PER_PAGE = 20;
const publishedArticles: PublishedArticle[] = [];

export default function ContentHistoryPage() {
  const t = useTranslations('ContentHistoryPage');
  const locale = useLocale();
  const [page, setPage] = useState(1);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const sortedArticles = useMemo(() => sortArticlesByPublishDate(publishedArticles), []);
  const totalArticles = sortedArticles.length;
  const totalPages = Math.max(1, Math.ceil(totalArticles / ARTICLES_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = totalArticles === 0 ? 0 : (currentPage - 1) * ARTICLES_PER_PAGE;
  const visibleArticles = sortedArticles.slice(startIndex, startIndex + ARTICLES_PER_PAGE);
  const endIndex = totalArticles === 0 ? 0 : startIndex + visibleArticles.length;
  const rangeLabel =
    totalArticles === 0
      ? t('pagination.emptyRange')
      : t('pagination.range', {
          end: endIndex,
          start: startIndex + 1,
          total: totalArticles,
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
        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(10rem,0.8fr)_11rem] border-slate-200 border-b bg-slate-50 px-4 py-2 font-semibold text-slate-600 text-xs">
          <span>{t('columns.articleName')}</span>
          <span>{t('columns.keyword')}</span>
          <span>{t('columns.publishDate')}</span>
        </div>

        {visibleArticles.length > 0 ? (
          <div className="divide-y divide-slate-200">
            {visibleArticles.map((article) => (
              <DesktopArticleRow
                key={article.id}
                article={article}
                dateFormatter={dateFormatter}
                t={t}
              />
            ))}
          </div>
        ) : (
          <EmptyState t={t} />
        )}
      </section>

      <section aria-label={t('listLabel')} className="grid gap-2 md:hidden">
        {visibleArticles.length > 0 ? (
          visibleArticles.map((article) => (
            <MobileArticleCard
              key={article.id}
              article={article}
              dateFormatter={dateFormatter}
              t={t}
            />
          ))
        ) : (
          <EmptyState t={t} framed />
        )}
      </section>

      <PaginationControls
        currentPage={currentPage}
        disabled={totalArticles === 0}
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
  t,
}: {
  article: PublishedArticle;
  dateFormatter: Intl.DateTimeFormat;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  const publishedDate = formatPublishedDate(article.publishedAt, dateFormatter);
  const rowClassName =
    'grid min-h-14 grid-cols-[minmax(0,1.5fr)_minmax(10rem,0.8fr)_11rem] items-center gap-0 px-4 py-3 text-sm';

  if (article.contentUrl) {
    return (
      <a
        href={article.contentUrl}
        aria-label={t('actions.openArticle', { title: article.title })}
        className={cn(
          rowClassName,
          'text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        <ArticleName title={article.title} linked />
        <span className="min-w-0 truncate px-3 text-slate-600">{article.keyword}</span>
        <time dateTime={article.publishedAt} className="min-w-0 truncate text-slate-600">
          {publishedDate}
        </time>
      </a>
    );
  }

  return (
    <div className={cn(rowClassName, 'text-slate-700')}>
      <ArticleName title={article.title} />
      <span className="min-w-0 truncate px-3 text-slate-600">{article.keyword}</span>
      <time dateTime={article.publishedAt} className="min-w-0 truncate text-slate-600">
        {publishedDate}
      </time>
    </div>
  );
}

function MobileArticleCard({
  article,
  dateFormatter,
  t,
}: {
  article: PublishedArticle;
  dateFormatter: Intl.DateTimeFormat;
  t: ReturnType<typeof useTranslations<'ContentHistoryPage'>>;
}) {
  const publishedDate = formatPublishedDate(article.publishedAt, dateFormatter);
  const card = (
    <Card className="gap-3 border-slate-200 py-4 shadow-none">
      <CardContent className="grid gap-3 px-4">
        <ArticleName title={article.title} linked={Boolean(article.contentUrl)} />
        <Separator />
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-slate-500 text-xs">{t('columns.keyword')}</dt>
            <dd className="mt-1 truncate font-medium text-slate-700">{article.keyword}</dd>
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
  );

  if (article.contentUrl) {
    return (
      <a
        href={article.contentUrl}
        aria-label={t('actions.openArticle', { title: article.title })}
        className="block rounded-lg transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {card}
      </a>
    );
  }

  return card;
}

function ArticleName({ linked = false, title }: { linked?: boolean; title: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 pr-3">
      <span className="min-w-0 truncate font-medium text-slate-950">{title}</span>
      {linked ? <ExternalLink className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" /> : null}
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

function sortArticlesByPublishDate(articles: PublishedArticle[]) {
  return [...articles].sort((first, second) => getPublishTime(second) - getPublishTime(first));
}

function getPublishTime(article: PublishedArticle) {
  const timestamp = new Date(article.publishedAt).getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatPublishedDate(publishedAt: string, formatter: Intl.DateTimeFormat) {
  const date = new Date(publishedAt);

  return Number.isNaN(date.getTime()) ? publishedAt : formatter.format(date);
}
