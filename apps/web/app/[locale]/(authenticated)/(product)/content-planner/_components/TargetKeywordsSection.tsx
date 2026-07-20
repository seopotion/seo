'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, LoaderCircle, LockKeyhole, Search, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { cn } from '@/lib/utils';
import { formatNumber, getCandidateDeleteApiError } from '../planner-utils';
import type { CandidateDeleteApiError, TargetKeyword, TargetKeywordStatus } from '../types';

const KEYWORDS_PER_PAGE = 20;

type DeleteError = Exclude<CandidateDeleteApiError, 'unauthorized'>;

class CandidateDeleteError extends Error {
  reason: CandidateDeleteApiError;

  constructor(reason: CandidateDeleteApiError) {
    super(reason);
    this.name = 'CandidateDeleteError';
    this.reason = reason;
  }
}

type TargetKeywordsSectionProps = {
  canResearch: boolean;
  loadError: boolean;
  loading: boolean;
  onResearch: () => void;
  onRetry: () => void;
  onUnauthorized: () => void;
  organizationId: string;
  researchAvailable: boolean;
  targetKeywords: TargetKeyword[];
};

export function TargetKeywordsSection({
  canResearch,
  loadError,
  loading,
  onResearch,
  onRetry,
  onUnauthorized,
  organizationId,
  researchAvailable,
  targetKeywords,
}: TargetKeywordsSectionProps) {
  const locale = useLocale();
  const t = useTranslations('ContentPlannerPage.targetKeywords');
  const queryClient = useQueryClient();
  const hasRows = targetKeywords.length > 0;
  const [page, setPage] = useState(1);
  const [renderedKeywords, setRenderedKeywords] = useState(targetKeywords);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, DeleteError>>({});

  const deleteMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      const response = await api.api.v0.keywords.candidates[':candidate_id'].$delete({
        param: { candidate_id: candidateId },
      });
      const status = response.status as number;

      if (status === 204) {
        return;
      }

      const responseBody: unknown = status === 409 ? await response.json() : undefined;
      const reason = getCandidateDeleteApiError(status, responseBody);

      if (reason === 'unauthorized') {
        onUnauthorized();
      }

      throw new CandidateDeleteError(reason);
    },
  });

  const handleDelete = async (candidateId: string) => {
    if (deleteMutation.isPending) {
      return;
    }

    // Two-click confirm: the first click arms the button, the second fires.
    if (confirmingId !== candidateId) {
      setConfirmingId(candidateId);
      return;
    }

    setConfirmingId(null);
    setDeleteErrors((current) => omitKey(current, candidateId));

    try {
      await deleteMutation.mutateAsync(candidateId);
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.candidatePool(organizationId),
      });
    } catch (error) {
      if (error instanceof CandidateDeleteError && error.reason === 'unauthorized') {
        return;
      }

      const reason: DeleteError =
        error instanceof CandidateDeleteError && error.reason !== 'unauthorized'
          ? error.reason
          : 'generic';
      setDeleteErrors((current) => ({ ...current, [candidateId]: reason }));

      // A refused delete means the row is stale (already scheduled or gone).
      if (reason === 'candidate_not_deletable' || reason === 'not_found') {
        await queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.candidatePool(organizationId),
        });
      }
    }
  };

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
                  <TableHeading className="w-32">
                    <span className="sr-only">{t('columns.action')}</span>
                  </TableHeading>
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
                    <td className="px-4 py-3">
                      {targetKeyword.source === 'candidate' ? (
                        <DeleteCandidateAction
                          confirming={confirmingId === targetKeyword.id}
                          error={deleteErrors[targetKeyword.id]}
                          keyword={targetKeyword.keyword}
                          onDelete={() => void handleDelete(targetKeyword.id)}
                          pending={
                            deleteMutation.isPending &&
                            deleteMutation.variables === targetKeyword.id
                          }
                          t={t}
                        />
                      ) : null}
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
                {targetKeyword.source === 'candidate' ? (
                  <DeleteCandidateAction
                    confirming={confirmingId === targetKeyword.id}
                    error={deleteErrors[targetKeyword.id]}
                    keyword={targetKeyword.keyword}
                    onDelete={() => void handleDelete(targetKeyword.id)}
                    pending={
                      deleteMutation.isPending && deleteMutation.variables === targetKeyword.id
                    }
                    t={t}
                  />
                ) : null}
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

function DeleteCandidateAction({
  confirming,
  error,
  keyword,
  onDelete,
  pending,
  t,
}: {
  confirming: boolean;
  error?: DeleteError;
  keyword: string;
  onDelete: () => void;
  pending: boolean;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>;
}) {
  return (
    <div className="grid justify-items-start gap-1 md:justify-items-end">
      <Button
        type="button"
        variant={confirming ? 'outline' : 'ghost'}
        size={confirming ? 'sm' : 'icon'}
        className={cn(confirming ? 'text-rose-700' : 'size-8 text-slate-500 hover:text-rose-700')}
        aria-label={t(confirming ? 'actions.confirmDelete' : 'actions.delete', { keyword })}
        disabled={pending}
        onClick={onDelete}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-4" aria-hidden="true" />
        )}
        {confirming && !pending ? t('actions.confirmDeleteLabel') : null}
      </Button>
      {error ? (
        <p role="alert" className="max-w-44 text-rose-700 text-xs">
          {t(`deleteErrors.${error}`)}
        </p>
      ) : null}
    </div>
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

function omitKey<TValue>(record: Record<string, TValue>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
