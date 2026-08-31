'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  Check,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Search,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { cn } from '@/lib/utils';
import { formatNumber, getCandidateDeleteApiError } from '../planner-utils';
import type { CandidateDeleteApiError, TargetKeyword, TargetKeywordStatus } from '../types';

const KEYWORDS_PER_PAGE = 20;
const STATUS_FILTER_OPTIONS: TargetKeywordStatus[] = [
  'available',
  'scheduled',
  'generating',
  'generated',
  'failed',
];
const STATUS_FILTER_PANEL_WIDTH = 224;

type SortKey = 'opportunityScore' | 'volume';

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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<TargetKeywordStatus>>(() => new Set());

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

  const applySort = (key: SortKey) => {
    // Descending only: re-clicking the active column is a no-op, other columns switch the sort.
    if (sortKey === key) {
      return;
    }

    setPage(1);
    setSortKey(key);
  };
  const toggleStatus = (status: TargetKeywordStatus) => {
    setPage(1);
    setStatusFilter((current) => {
      const next = new Set(current);

      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }

      return next;
    });
  };
  const clearStatusFilter = () => {
    setPage(1);
    setStatusFilter(new Set());
  };

  const processedKeywords = useMemo(() => {
    const filtered =
      statusFilter.size > 0
        ? targetKeywords.filter((keyword) => statusFilter.has(keyword.status))
        : targetKeywords;

    if (!sortKey) {
      return filtered;
    }

    return [...filtered].sort((a, b) => compareMetricDescending(a[sortKey], b[sortKey]));
  }, [sortKey, statusFilter, targetKeywords]);

  const totalPages = Math.max(1, Math.ceil(processedKeywords.length / KEYWORDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * KEYWORDS_PER_PAGE;
  const visibleKeywords = useMemo(
    () => processedKeywords.slice(startIndex, startIndex + KEYWORDS_PER_PAGE),
    [processedKeywords, startIndex],
  );

  return (
    <section aria-labelledby="target-keywords-heading" className="grid gap-3">
      <header className="flex min-h-10 flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0">
          <h2 id="target-keywords-heading" className="font-semibold text-base text-foreground">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('description')}</p>
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
          className="flex flex-col items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{t('states.loadError')}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        </div>
      ) : null}

      {hasRows ? (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <Table aria-label={t('tableLabel')} className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">{t('columns.keyword')}</TableHead>
                  <TableHead>{t('columns.difficulty')}</TableHead>
                  <TableHead aria-sort={sortKey === 'volume' ? 'descending' : 'none'}>
                    <SortHeaderButton
                      active={sortKey === 'volume'}
                      label={t('columns.volume')}
                      onSort={() => applySort('volume')}
                      sortLabel={t('sort.byDescending', { column: t('columns.volume') })}
                    />
                  </TableHead>
                  <TableHead>{t('columns.intent')}</TableHead>
                  <TableHead aria-sort={sortKey === 'opportunityScore' ? 'descending' : 'none'}>
                    <SortHeaderButton
                      active={sortKey === 'opportunityScore'}
                      label={t('columns.opportunityScore')}
                      onSort={() => applySort('opportunityScore')}
                      sortLabel={t('sort.byDescending', { column: t('columns.opportunityScore') })}
                    />
                  </TableHead>
                  <TableHead>
                    <StatusFilterHeader
                      label={t('columns.status')}
                      onClear={clearStatusFilter}
                      onToggle={toggleStatus}
                      selected={statusFilter}
                      t={t}
                    />
                  </TableHead>
                  <TableHead className="w-32">
                    <span className="sr-only">{t('columns.action')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleKeywords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center">
                      <div className="grid justify-items-center gap-2 text-muted-foreground text-sm">
                        <span>{t('states.noFilterMatches')}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={clearStatusFilter}
                        >
                          {t('filter.clear')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
                {visibleKeywords.map((targetKeyword) => (
                  <TableRow key={`${targetKeyword.source}-${targetKeyword.id}`}>
                    <TableCell className="truncate font-medium text-foreground">
                      {targetKeyword.keyword}
                    </TableCell>
                    <MetricCell value={targetKeyword.difficulty} locale={locale} t={t} />
                    <MetricCell value={targetKeyword.volume} locale={locale} t={t} />
                    <TableCell className="truncate text-muted-foreground">
                      {targetKeyword.intent
                        ? t(`intents.${targetKeyword.intent}`)
                        : t('notAvailable')}
                    </TableCell>
                    <MetricCell value={targetKeyword.opportunityScore} locale={locale} t={t} />
                    <TableCell>
                      <TargetKeywordStatusBadge status={targetKeyword.status} t={t} />
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul aria-label={t('listLabel')} className="grid list-none gap-2 md:hidden">
            {visibleKeywords.length === 0 ? (
              <li className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground text-sm">
                {t('states.noFilterMatches')}
              </li>
            ) : null}
            {visibleKeywords.map((targetKeyword) => (
              <li
                key={`${targetKeyword.source}-${targetKeyword.id}`}
                className="grid gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <h3 className="min-w-0 wrap-break-words font-semibold text-foreground text-sm">
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
          className="flex items-center justify-center gap-2 text-muted-foreground text-sm"
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
            total: processedKeywords.length,
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
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="truncate text-foreground text-sm">{rangeLabel}</p>
        <p className="mt-0.5 truncate text-muted-foreground text-xs">
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
        <span className="min-w-20 text-center font-medium text-muted-foreground text-sm">
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
        className={cn(
          confirming ? 'text-red-700' : 'size-8 text-muted-foreground hover:text-red-700',
        )}
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
        <p role="alert" className="max-w-44 text-red-700 text-xs">
          {t(`deleteErrors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

function SortHeaderButton({
  active,
  label,
  onSort,
  sortLabel,
}: {
  active: boolean;
  label: string;
  onSort: () => void;
  sortLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={sortLabel}
      onClick={onSort}
      className={cn(
        'group -mx-1 flex items-center gap-1 rounded px-1 py-0.5 font-semibold text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <ArrowDownWideNarrow
        aria-hidden="true"
        className={cn(
          'size-3.5 transition-opacity',
          active ? 'text-sky-600 opacity-100' : 'opacity-40 group-hover:opacity-70',
        )}
      />
    </button>
  );
}

function StatusFilterHeader({
  label,
  onClear,
  onToggle,
  selected,
  t,
}: {
  label: string;
  onClear: () => void;
  onToggle: (status: TargetKeywordStatus) => void;
  selected: Set<TargetKeywordStatus>;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage.targetKeywords'>>;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeCount = selected.size;
  const filtering = activeCount > 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    const trigger = triggerRef.current;

    if (!trigger) {
      return;
    }

    const reposition = () => setCoords(computeStatusFilterCoords(trigger));

    reposition();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={filtering ? t('filter.activeLabel', { count: activeCount }) : t('filter.label')}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          '-mx-1 flex items-center gap-1 rounded px-1 py-0.5 font-semibold text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          filtering ? 'text-sky-700' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span>{label}</span>
        <ListFilter
          aria-hidden="true"
          className={cn('size-3.5', filtering ? 'text-sky-600' : 'opacity-40')}
        />
        {filtering ? (
          <span className="flex min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 font-semibold text-[10px] text-white leading-4">
            {activeCount}
          </span>
        ) : null}
      </button>
      {open && coords && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className="z-50 w-56 rounded-lg border border-border bg-card p-1 shadow-lg"
              style={{ left: coords.left, position: 'fixed', top: coords.top }}
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="font-medium text-muted-foreground text-xs">
                  {t('filter.heading')}
                </span>
                <button
                  type="button"
                  disabled={!filtering}
                  onClick={onClear}
                  className="rounded px-1 py-0.5 font-medium text-sky-700 text-xs transition-colors hover:text-sky-800 disabled:cursor-default disabled:text-muted-foreground/50"
                >
                  {t('filter.clear')}
                </button>
              </div>
              <ul className="grid list-none">
                {STATUS_FILTER_OPTIONS.map((status) => {
                  const checked = selected.has(status);

                  return (
                    <li key={status}>
                      <button
                        type="button"
                        aria-pressed={checked}
                        onClick={() => onToggle(status)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                            checked ? 'border-sky-600 bg-sky-600 text-white' : 'border-input',
                          )}
                        >
                          {checked ? <Check className="size-3" aria-hidden="true" /> : null}
                        </span>
                        <TargetKeywordStatusBadge status={status} t={t} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function computeStatusFilterCoords(trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - STATUS_FILTER_PANEL_WIDTH - 8));

  return { left, top: rect.bottom + 4 };
}

function compareMetricDescending(a: number | null, b: number | null) {
  if (a === b) {
    return 0;
  }

  // Missing metrics always sink to the bottom.
  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return b - a;
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

function MobileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground text-sm">{value}</dd>
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
        status === 'available' && 'bg-muted text-foreground',
        status === 'scheduled' && 'bg-sky-100 text-sky-700',
        status === 'generating' && 'bg-amber-100 text-amber-700',
        status === 'generated' && 'bg-emerald-100 text-emerald-700',
        status === 'failed' && 'bg-red-100 text-red-700',
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
      className="flex min-h-28 items-center justify-center rounded-lg border border-border bg-card px-6 py-8 text-center"
    >
      <div className="grid justify-items-center gap-1.5">
        {loading ? (
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        {title ? <h3 className="font-semibold text-foreground text-sm">{title}</h3> : null}
        <p className="text-muted-foreground text-sm">{message}</p>
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
