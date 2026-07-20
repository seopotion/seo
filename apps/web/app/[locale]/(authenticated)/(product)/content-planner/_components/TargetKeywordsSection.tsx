'use client';

import { ChevronLeft, ChevronRight, LoaderCircle, LockKeyhole, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatNumber } from '../planner-utils';
import type { TargetKeyword, TargetKeywordStatus } from '../types';

const KEYWORDS_PER_PAGE = 20;

type TargetKeywordsSectionProps = {
  canResearch: boolean;
  loadError: boolean;
  loading: boolean;
  onResearch: () => void;
  onRetry: () => void;
  researchAvailable: boolean;
  targetKeywords: TargetKeyword[];
};

export function TargetKeywordsSection({
  canResearch,
  loadError,
  loading,
  onResearch,
  onRetry,
  researchAvailable,
  targetKeywords,
}: TargetKeywordsSectionProps) {
  const locale = useLocale();
  const t = useTranslations('ContentPlannerPage.targetKeywords');
  const hasRows = targetKeywords.length > 0;
  const [page, setPage] = useState(1);
  const [renderedKeywords, setRenderedKeywords] = useState(targetKeywords);

  // The list is replaced wholesale (organization switch, research, retry, streamed pages),
  // so a stale page number would strand the reader outside the new list.
  if (renderedKeywords !== targetKeywords) {
    setRenderedKeywords(targetKeywords);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(targetKeywords.length / KEYWORDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * KEYWORDS_PER_PAGE;
  const visibleKeywords = useMemo(
    () => targetKeywords.slice(startIndex, startIndex + KEYWORDS_PER_PAGE),
    [startIndex, targetKeywords],
  );

  return (
    <section aria-labelledby="target-keywords-heading" className="grid gap-3">
      <header className="flex min-h-10 flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0">
          <h2 id="target-keywords-heading" className="font-semibold text-base text-slate-950">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-slate-600 text-sm">{t('description')}</p>
        </div>
        <div className="grid shrink-0 gap-1 sm:justify-items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!researchAvailable}
            onClick={onResearch}
          >
            {canResearch ? (
              <Search className="size-4" aria-hidden="true" />
            ) : (
              <LockKeyhole className="size-4" aria-hidden="true" />
            )}
            {t('actions.research')}
          </Button>
          {researchAvailable && !canResearch ? (
            <p className="text-amber-700 text-xs">{t('researchPaidFeature')}</p>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{t('states.loadError')}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        </div>
      ) : null}

      {hasRows ? (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
            <table aria-label={t('tableLabel')} className="w-full table-fixed text-left text-sm">
              <thead className="border-slate-200 border-b bg-slate-50 text-slate-600">
                <tr>
                  <TableHeading className="w-[30%]">{t('columns.keyword')}</TableHeading>
                  <TableHeading>{t('columns.difficulty')}</TableHeading>
                  <TableHeading>{t('columns.volume')}</TableHeading>
                  <TableHeading>{t('columns.intent')}</TableHeading>
                  <TableHeading>{t('columns.opportunityScore')}</TableHeading>
                  <TableHeading>{t('columns.status')}</TableHeading>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleKeywords.map((targetKeyword) => (
                  <tr key={`${targetKeyword.source}-${targetKeyword.id}`}>
                    <td className="truncate px-4 py-3 font-medium text-slate-950">
                      {targetKeyword.keyword}
                    </td>
                    <MetricCell value={targetKeyword.difficulty} locale={locale} t={t} />
                    <MetricCell value={targetKeyword.volume} locale={locale} t={t} />
                    <td className="truncate px-4 py-3 text-slate-600">
                      {targetKeyword.intent
                        ? t(`intents.${targetKeyword.intent}`)
                        : t('notAvailable')}
                    </td>
                    <MetricCell value={targetKeyword.opportunityScore} locale={locale} t={t} />
                    <td className="px-4 py-3">
                      <TargetKeywordStatusBadge status={targetKeyword.status} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul aria-label={t('listLabel')} className="grid list-none gap-2 md:hidden">
            {visibleKeywords.map((targetKeyword) => (
              <li
                key={`${targetKeyword.source}-${targetKeyword.id}`}
                className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <h3 className="min-w-0 wrap-break-words font-semibold text-slate-950 text-sm">
                    {targetKeyword.keyword}
                  </h3>
                  <TargetKeywordStatusBadge status={targetKeyword.status} t={t} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <MobileMetric
                    label={t('columns.difficulty')}
                    value={formatMetric(targetKeyword.difficulty, locale, t)}
                  />
                  <MobileMetric
                    label={t('columns.volume')}
                    value={formatMetric(targetKeyword.volume, locale, t)}
                  />
                  <MobileMetric
                    label={t('columns.intent')}
                    value={
                      targetKeyword.intent
                        ? t(`intents.${targetKeyword.intent}`)
                        : t('notAvailable')
                    }
                  />
                  <MobileMetric
                    label={t('columns.opportunityScore')}
                    value={formatMetric(targetKeyword.opportunityScore, locale, t)}
                  />
                </dl>
              </li>
            ))}
          </ul>
        </>
      ) : loading ? (
        <TargetKeywordState loading message={t('states.loading')} />
      ) : loadError ? null : (
        <TargetKeywordState message={t('states.emptyDescription')} title={t('states.emptyTitle')} />
      )}

      {hasRows && loading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 text-slate-600 text-sm"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span>{t('states.loading')}</span>
        </div>
      ) : null}

      {hasRows && totalPages > 1 ? (
        <PaginationControls
          currentPage={currentPage}
          rangeLabel={t('pagination.range', {
            end: startIndex + visibleKeywords.length,
            start: startIndex + 1,
            total: targetKeywords.length,
          })}
          setPage={setPage}
          totalPages={totalPages}
          t={t}
        />
      ) : null}
    </section>
  );
}

function PaginationControls({
  currentPage,
  rangeLabel,
  setPage,
  totalPages,
  t,
}: {
  currentPage: number;
  rangeLabel: string;
  setPage: (updater: (page: number) => number) => void;
  totalPages: number;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>;
}) {
  return (
    <nav
      aria-label={t('pagination.label')}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="truncate text-slate-700 text-sm">{rangeLabel}</p>
        <p className="mt-0.5 truncate text-slate-500 text-xs">
          {t('pagination.perPage', { count: KEYWORDS_PER_PAGE })}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full min-w-0 sm:w-auto sm:min-w-28"
          disabled={currentPage === 1}
          onClick={() => setPage((previousPage) => Math.max(1, previousPage - 1))}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t('pagination.previous')}
        </Button>
        <span className="min-w-20 text-center font-medium text-slate-600 text-sm">
          {t('pagination.page', { page: currentPage, totalPages })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full min-w-0 sm:w-auto sm:min-w-28"
          disabled={currentPage === totalPages}
          onClick={() => setPage((previousPage) => Math.min(totalPages, previousPage + 1))}
        >
          {t('pagination.next')}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

function TableHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('px-4 py-2 font-semibold text-xs', className)}>
      {children}
    </th>
  );
}

function MetricCell({
  locale,
  t,
  value,
}: {
  locale: string;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>;
  value: number | null;
}) {
  return <td className="px-4 py-3 text-slate-600">{formatMetric(value, locale, t)}</td>;
}

function MobileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500 text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-slate-800 text-sm">{value}</dd>
    </div>
  );
}

function TargetKeywordStatusBadge({
  status,
  t,
}: {
  status: TargetKeywordStatus;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'border-transparent',
        status === 'available' && 'bg-slate-200 text-slate-700',
        status === 'scheduled' && 'bg-sky-100 text-sky-700',
        status === 'generating' && 'bg-amber-100 text-amber-700',
        status === 'generated' && 'bg-emerald-100 text-emerald-700',
        status === 'failed' && 'bg-rose-100 text-rose-700',
      )}
    >
      {t(`statuses.${status}`)}
    </Badge>
  );
}

function TargetKeywordState({
  loading = false,
  message,
  title,
}: {
  loading?: boolean;
  message: string;
  title?: string;
}) {
  return (
    <div
      role={loading ? 'status' : undefined}
      className="flex min-h-28 items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-8 text-center"
    >
      <div className="grid justify-items-center gap-1.5">
        {loading ? (
          <LoaderCircle className="size-5 animate-spin text-slate-500" aria-hidden="true" />
        ) : null}
        {title ? <h3 className="font-semibold text-slate-950 text-sm">{title}</h3> : null}
        <p className="text-slate-600 text-sm">{message}</p>
      </div>
    </div>
  );
}

function formatMetric(
  value: number | null,
  locale: string,
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>,
) {
  return value === null ? t('notAvailable') : formatNumber(value, locale);
}
