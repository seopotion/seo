'use client';

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Minus,
  Search,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { formatCount, formatCtr, formatPosition, needsAttention } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { AnalyticsArticle } from '../types';

const ARTICLES_PER_PAGE = 10;

type SortDirection = 'asc' | 'desc';
type SortKey = 'published_at' | 'days_live' | 'clicks' | 'impressions' | 'ctr' | 'position';

export function AnalyticsArticleTable({ articles }: { articles: AnalyticsArticle[] }) {
  const t = useTranslations('AnalyticsPage');
  const locale = useLocale();
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState<{ direction: SortDirection; key: SortKey }>({
    direction: 'desc',
    key: 'impressions',
  });
  const [page, setPage] = useState(1);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const filteredArticles = useMemo(() => {
    const normalizedFilter = filter.trim().toLocaleLowerCase(locale);
    const matching = articles.filter(
      (article) =>
        (!normalizedFilter || article.title.toLocaleLowerCase(locale).includes(normalizedFilter)) &&
        (!attentionOnly || needsAttention(article)),
    );

    return matching.toSorted((left, right) => {
      const comparison = sortValue(left, sort.key) - sortValue(right, sort.key);
      if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison;
      return left.title.localeCompare(right.title, locale);
    });
  }, [articles, attentionOnly, filter, locale, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredArticles.length / ARTICLES_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * ARTICLES_PER_PAGE;
  const visibleArticles = filteredArticles.slice(startIndex, startIndex + ARTICLES_PER_PAGE);

  function updateSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
    setPage(1);
  }

  function openArticle(articleId: string) {
    router.push(`/analytics/${articleId}`);
  }

  const rangeLabel =
    filteredArticles.length === 0
      ? t('table.pagination.emptyRange')
      : t('table.pagination.range', {
          start: startIndex + 1,
          end: startIndex + visibleArticles.length,
          total: filteredArticles.length,
        });

  return (
    <section aria-labelledby="analytics-articles-title" className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="analytics-articles-title" className="font-semibold text-base text-foreground">
            {t('table.title')}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{t('table.description')}</p>
        </div>
        <Badge variant="secondary" className="w-fit bg-muted text-foreground">
          {t('table.articleCount', { count: articles.length })}
        </Badge>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative block flex-1" htmlFor="analytics-article-filter">
          <span className="sr-only">{t('table.filterLabel')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="analytics-article-filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
            placeholder={t('table.filterPlaceholder')}
            className="bg-card pl-9"
          />
        </label>
        <Button
          variant={attentionOnly ? 'secondary' : 'outline'}
          aria-pressed={attentionOnly}
          onClick={() => {
            setAttentionOnly((current) => !current);
            setPage(1);
          }}
        >
          {t('table.needsAttention')}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table className="min-w-5xl border-collapse">
          <TableHeader>
            <TableRow>
              <TableHead className="py-3 text-sm">{t('table.columns.title')}</TableHead>
              <SortableHeader
                activeSort={sort}
                label={t('table.columns.publishedDate')}
                sortKey="published_at"
                updateSort={updateSort}
              />
              <SortableHeader
                activeSort={sort}
                label={t('table.columns.daysLive')}
                sortKey="days_live"
                updateSort={updateSort}
              />
              <SortableHeader
                activeSort={sort}
                label={t('table.columns.clicks')}
                sortKey="clicks"
                updateSort={updateSort}
              />
              <SortableHeader
                activeSort={sort}
                label={t('table.columns.impressions')}
                sortKey="impressions"
                updateSort={updateSort}
              />
              <SortableHeader
                activeSort={sort}
                label={t('table.columns.ctr')}
                sortKey="ctr"
                updateSort={updateSort}
              />
              <SortableHeader
                activeSort={sort}
                label={t('table.columns.position')}
                sortKey="position"
                updateSort={updateSort}
              />
              <TableHead className="py-3 text-sm">{t('table.columns.trend')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleArticles.map((article) => (
              <ArticleRow
                key={article.article_id}
                article={article}
                dateFormatter={dateFormatter}
                locale={locale}
                openArticle={openArticle}
              />
            ))}
          </TableBody>
        </Table>
        {visibleArticles.length === 0 ? (
          <div className="grid min-h-40 place-items-center px-4 text-center text-muted-foreground text-sm">
            {articles.length === 0 ? t('table.empty') : t('table.noMatches')}
          </div>
        ) : null}
      </div>

      <nav
        aria-label={t('table.pagination.label')}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-muted-foreground text-sm">{rangeLabel}</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1 || filteredArticles.length === 0}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t('table.pagination.previous')}
          </Button>
          <span className="min-w-20 text-center text-muted-foreground text-sm">
            {t('table.pagination.page', { page: currentPage, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === totalPages || filteredArticles.length === 0}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            {t('table.pagination.next')}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </nav>
    </section>
  );
}

function SortableHeader({
  activeSort,
  label,
  sortKey,
  updateSort,
}: {
  activeSort: { direction: SortDirection; key: SortKey };
  label: string;
  sortKey: SortKey;
  updateSort: (key: SortKey) => void;
}) {
  const active = activeSort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : activeSort.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TableHead className="py-3 text-sm">
      <button
        type="button"
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
        onClick={() => updateSort(sortKey)}
      >
        {label}
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    </TableHead>
  );
}

function ArticleRow({
  article,
  dateFormatter,
  locale,
  openArticle,
}: {
  article: AnalyticsArticle;
  dateFormatter: Intl.DateTimeFormat;
  locale: string;
  openArticle: (articleId: string) => void;
}) {
  const t = useTranslations('AnalyticsPage');
  const attention = needsAttention(article);

  return (
    <TableRow
      tabIndex={0}
      aria-label={t('table.openArticle', { title: article.title })}
      className="cursor-pointer text-foreground transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={() => openArticle(article.article_id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openArticle(article.article_id);
        }
      }}
    >
      <TableCell className="max-w-80">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{article.title}</span>
          {attention ? <Badge variant="warning">{t('table.attentionBadge')}</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {article.published_at ? (
          <time dateTime={article.published_at}>
            {formatDate(article.published_at, dateFormatter)}
          </time>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="tabular-nums">{formatCount(article.days_live, locale)}</TableCell>
      {article.data_state === 'awaiting' ? (
        <TableCell colSpan={5} className="font-medium text-muted-foreground">
          {t('table.awaitingData')}
        </TableCell>
      ) : (
        <>
          <TableCell className="tabular-nums">{formatCount(article.clicks, locale)}</TableCell>
          <TableCell className="tabular-nums">{formatCount(article.impressions, locale)}</TableCell>
          <TableCell className="tabular-nums">{formatCtr(article.ctr, locale)}</TableCell>
          <TableCell className="tabular-nums">{formatPosition(article.position, locale)}</TableCell>
          <TableCell>
            {article.data_state === 'gathering' ? (
              <span className="whitespace-nowrap text-muted-foreground">
                {t('table.stillGathering')}
              </span>
            ) : (
              <Trend trend={article.trend} />
            )}
          </TableCell>
        </>
      )}
    </TableRow>
  );
}

function Trend({ trend }: { trend: AnalyticsArticle['trend'] }) {
  const t = useTranslations('AnalyticsPage');
  const normalizedTrend = trend ?? 'flat';
  const Icon = normalizedTrend === 'up' ? ArrowUp : normalizedTrend === 'down' ? ArrowDown : Minus;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        normalizedTrend === 'up'
          ? 'text-success'
          : normalizedTrend === 'down'
            ? 'text-error'
            : 'text-muted-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{t(`table.trends.${normalizedTrend}`)}</span>
    </span>
  );
}

function sortValue(article: AnalyticsArticle, key: SortKey): number {
  if (key === 'published_at') {
    return article.published_at ? new Date(article.published_at).getTime() : 0;
  }
  return article[key];
}

function formatDate(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
