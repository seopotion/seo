'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import {
  formatDateFromKey,
  formatNumber,
  getCandidateScheduleError,
  isCandidateScheduleSuccess,
} from '../planner-utils';
import type { CandidateKeywordResponse, CandidateScheduleError } from '../types';

class CandidateScheduleApiError extends Error {
  reason: CandidateScheduleError | 'unauthorized';

  constructor(reason: CandidateScheduleError | 'unauthorized') {
    super(reason);
    this.name = 'CandidateScheduleApiError';
    this.reason = reason;
  }
}

export function ChooseKeywordModal({
  canSchedule,
  candidates,
  dateKey,
  hasMore,
  loadError,
  loading,
  loadingMore,
  onClose,
  onLoadMore,
  onOpenResearch,
  onRetry,
  onUnauthorized,
  open,
  organizationId,
}: {
  canSchedule: boolean;
  candidates: CandidateKeywordResponse[];
  dateKey: string | null;
  hasMore: boolean;
  loadError: boolean;
  loading: boolean;
  loadingMore: boolean;
  onClose: () => void;
  onLoadMore: () => void;
  onOpenResearch: () => void;
  onRetry: () => void;
  onUnauthorized: () => void;
  open: boolean;
  organizationId: string;
}) {
  const locale = useLocale();
  const t = useTranslations('ContentPlannerPage.chooseKeyword');
  const targetKeywordsT = useTranslations('ContentPlannerPage.targetKeywords');
  const queryClient = useQueryClient();
  // `upgrade` is not an error banner — it swaps the whole body for the upgrade
  // panel (see `showUpgrade`), so it never reaches `errors.*` and has no message.
  const [scheduleError, setScheduleError] = useState<Exclude<
    CandidateScheduleError,
    'upgrade'
  > | null>(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const schedulePendingRef = useRef(false);
  const sessionRef = useRef(0);

  useEffect(
    () => () => {
      sessionRef.current += 1;
    },
    [],
  );

  const scheduleMutation = useMutation({
    mutationFn: async ({
      candidateId,
      scheduledDate,
    }: {
      candidateId: string;
      scheduledDate: string;
    }) => {
      const response = await api.api.v0.keywords.candidates[':candidate_id'].schedule.$post({
        param: { candidate_id: candidateId },
        json: { scheduled_date: scheduledDate },
      });
      const status = response.status as number;

      if (status === 401) {
        onUnauthorized();
        throw new CandidateScheduleApiError('unauthorized');
      }

      if (isCandidateScheduleSuccess(status)) {
        return;
      }

      const responseBody: unknown = status === 409 ? await response.json() : undefined;
      throw new CandidateScheduleApiError(getCandidateScheduleError(status, responseBody));
    },
  });

  const handleClose = () => {
    if (schedulePendingRef.current) {
      return;
    }

    setScheduleError(null);
    setUpgradeRequired(false);
    scheduleMutation.reset();
    onClose();
  };

  const handleSchedule = async (candidate: CandidateKeywordResponse) => {
    if (!canSchedule || !candidate.schedulable || !dateKey || schedulePendingRef.current) {
      return;
    }

    schedulePendingRef.current = true;
    setScheduleError(null);
    const session = sessionRef.current;

    try {
      await scheduleMutation.mutateAsync({
        candidateId: candidate.id,
        scheduledDate: dateKey,
      });
      await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.candidatePool(organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.planner(organizationId),
        }),
      ]);

      if (session !== sessionRef.current) {
        return;
      }

      setScheduleError(null);
      scheduleMutation.reset();
      onClose();
    } catch (error) {
      if (!(error instanceof CandidateScheduleApiError)) {
        if (session === sessionRef.current) {
          setScheduleError('generic');
        }
        return;
      }

      if (error.reason === 'unauthorized') {
        return;
      }

      if (error.reason === 'upgrade') {
        if (session === sessionRef.current) {
          setUpgradeRequired(true);
        }
        return;
      }

      if (session === sessionRef.current) {
        setScheduleError(error.reason);
      }

      await refreshQueriesForScheduleError(error.reason, organizationId, queryClient);
    } finally {
      schedulePendingRef.current = false;
    }
  };

  const handleOpenResearch = () => {
    if (schedulePendingRef.current) {
      return;
    }

    setScheduleError(null);
    setUpgradeRequired(false);
    scheduleMutation.reset();
    onOpenResearch();
  };

  const titleId = 'choose-keyword-dialog-title';
  const formattedDate = dateKey ? formatDateFromKey(dateKey, locale) : '';
  const showUpgrade = !canSchedule || upgradeRequired;

  return (
    <Modal closeLabel={t('actions.close')} labelledBy={titleId} onClose={handleClose} open={open}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-border border-b px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="font-semibold text-lg text-foreground">
            {t('title', { date: formattedDate })}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('actions.close')}
          className="size-9"
          disabled={scheduleMutation.isPending}
          onClick={handleClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>

      {showUpgrade ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="max-w-md rounded-lg border border-warning-border bg-warning-subtle px-5 py-6 text-center">
            <h3 className="font-semibold text-warning">{t('upgrade.title')}</h3>
            <p className="mt-2 text-warning text-sm">{t('upgrade.description')}</p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/billing">{t('upgrade.cta')}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {scheduleError ? (
            <div
              role="alert"
              className="mb-3 rounded-md border border-error-border bg-error-subtle px-4 py-3 text-error text-sm"
            >
              {t(`errors.${scheduleError}`)}
            </div>
          ) : null}

          {loadError ? (
            <div
              role="alert"
              className="mb-3 flex flex-col items-start gap-2 rounded-md border border-error-border bg-error-subtle px-4 py-3 text-error text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{t('states.loadError')}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={scheduleMutation.isPending}
                onClick={onRetry}
              >
                {t('actions.retry')}
              </Button>
            </div>
          ) : null}

          {candidates.length > 0 ? (
            <CandidateList
              candidates={candidates}
              locale={locale}
              onSchedule={(candidate) => void handleSchedule(candidate)}
              pendingCandidateId={
                scheduleMutation.isPending ? scheduleMutation.variables?.candidateId : undefined
              }
              schedulingPending={scheduleMutation.isPending}
              t={t}
              targetKeywordsT={targetKeywordsT}
            />
          ) : loading ? (
            <ChooserState loading message={t('states.loading')} />
          ) : loadError ? null : (
            <ChooserEmptyState onResearch={handleOpenResearch} t={t} />
          )}

          {hasMore && candidates.length > 0 ? (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingMore || scheduleMutation.isPending}
                onClick={onLoadMore}
              >
                {loadingMore ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {loadingMore ? t('actions.loadingMore') : t('actions.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function CandidateList({
  candidates,
  locale,
  onSchedule,
  pendingCandidateId,
  schedulingPending,
  t,
  targetKeywordsT,
}: {
  candidates: CandidateKeywordResponse[];
  locale: string;
  onSchedule: (candidate: CandidateKeywordResponse) => void;
  pendingCandidateId?: string;
  schedulingPending: boolean;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.chooseKeyword'>>;
  targetKeywordsT: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>;
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <Table aria-label={t('tableLabel')} className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28%]">{t('columns.keyword')}</TableHead>
              <TableHead>{t('columns.difficulty')}</TableHead>
              <TableHead>{t('columns.volume')}</TableHead>
              <TableHead>{t('columns.intent')}</TableHead>
              <TableHead>{t('columns.opportunityScore')}</TableHead>
              <TableHead className="w-44">
                <span className="sr-only">{t('columns.action')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => (
              <TableRow key={candidate.id}>
                <TableCell className="wrap-break-words font-medium text-foreground">
                  {candidate.keyword}
                </TableCell>
                <MetricCell locale={locale} t={targetKeywordsT} value={candidate.difficulty} />
                <MetricCell locale={locale} t={targetKeywordsT} value={candidate.search_volume} />
                <TableCell className="truncate text-muted-foreground">
                  {formatIntent(candidate, targetKeywordsT)}
                </TableCell>
                <MetricCell
                  locale={locale}
                  t={targetKeywordsT}
                  value={candidate.opportunity_score}
                />
                <TableCell>
                  <ScheduleAction
                    candidate={candidate}
                    onSchedule={() => onSchedule(candidate)}
                    pending={pendingCandidateId === candidate.id}
                    schedulingPending={schedulingPending}
                    t={t}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul aria-label={t('listLabel')} className="grid list-none gap-2 md:hidden">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="grid gap-3 rounded-lg border border-border bg-card p-3">
            <h3 className="wrap-break-words font-semibold text-foreground text-sm">
              {candidate.keyword}
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Metric
                label={t('columns.difficulty')}
                value={formatMetric(candidate.difficulty, locale, targetKeywordsT)}
              />
              <Metric
                label={t('columns.volume')}
                value={formatMetric(candidate.search_volume, locale, targetKeywordsT)}
              />
              <Metric
                label={t('columns.intent')}
                value={formatIntent(candidate, targetKeywordsT)}
              />
              <Metric
                label={t('columns.opportunityScore')}
                value={formatMetric(candidate.opportunity_score, locale, targetKeywordsT)}
              />
            </dl>
            <ScheduleAction
              candidate={candidate}
              onSchedule={() => onSchedule(candidate)}
              pending={pendingCandidateId === candidate.id}
              schedulingPending={schedulingPending}
              t={t}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function ScheduleAction({
  candidate,
  onSchedule,
  pending,
  schedulingPending,
  t,
}: {
  candidate: CandidateKeywordResponse;
  onSchedule: () => void;
  pending: boolean;
  schedulingPending: boolean;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.chooseKeyword'>>;
}) {
  return (
    <div className="grid justify-items-start gap-1 md:justify-items-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!candidate.schedulable || schedulingPending}
        onClick={onSchedule}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? t('actions.scheduling') : t('actions.schedule')}
      </Button>
      {!candidate.schedulable ? (
        <p className="max-w-44 text-muted-foreground text-xs">{t('missingMetrics')}</p>
      ) : null}
    </div>
  );
}

function ChooserEmptyState({
  onResearch,
  t,
}: {
  onResearch: () => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.chooseKeyword'>>;
}) {
  return (
    <div className="flex min-h-52 items-center justify-center text-center">
      <div className="grid max-w-md justify-items-center gap-2">
        <Search className="size-5 text-muted-foreground" aria-hidden="true" />
        <h3 className="font-semibold text-foreground text-sm">{t('states.emptyTitle')}</h3>
        <p className="text-muted-foreground text-sm">{t('states.emptyDescription')}</p>
        <Button type="button" variant="outline" size="sm" onClick={onResearch}>
          <Search className="size-4" aria-hidden="true" />
          {t('actions.research')}
        </Button>
      </div>
    </div>
  );
}

function ChooserState({ loading = false, message }: { loading?: boolean; message: string }) {
  return (
    <div
      role={loading ? 'status' : undefined}
      className="flex min-h-40 items-center justify-center text-center"
    >
      <div className="grid max-w-md justify-items-center gap-2 text-muted-foreground text-sm">
        {loading ? (
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        <p>{message}</p>
      </div>
    </div>
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
  return <TableCell className="text-muted-foreground">{formatMetric(value, locale, t)}</TableCell>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground text-sm">{value}</dd>
    </div>
  );
}

function formatIntent(
  candidate: CandidateKeywordResponse,
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>,
) {
  return candidate.intent ? t(`intents.${candidate.intent}`) : t('notAvailable');
}

function formatMetric(
  value: number | null,
  locale: string,
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>,
) {
  return value === null ? t('notAvailable') : formatNumber(value, locale);
}

async function refreshQueriesForScheduleError(
  error: CandidateScheduleError,
  organizationId: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const refreshCandidates =
    error === 'candidate_already_scheduled' ||
    error === 'candidate_not_schedulable' ||
    error === 'keyword_already_scheduled' ||
    error === 'not_found';
  const refreshPlanner =
    error === 'candidate_already_scheduled' ||
    error === 'date_occupied' ||
    error === 'keyword_already_scheduled';
  const invalidations: Promise<unknown>[] = [];

  if (refreshCandidates) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.candidatePool(organizationId),
      }),
    );
  }

  if (refreshPlanner) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.planner(organizationId),
      }),
    );
  }

  await Promise.allSettled(invalidations);
}
