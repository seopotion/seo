'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';
import { ArticleEditorModal } from './_components/ArticleEditorModal';
import { ChooseKeywordModal } from './_components/ChooseKeywordModal';
import { ResearchKeywordsModal } from './_components/ResearchKeywordsModal';
import { TargetKeywordsSection } from './_components/TargetKeywordsSection';
import { createPlannerFixtureArticles } from './fixtures';
import {
  addMonths,
  buildMonthWeeks,
  combineTargetKeywords,
  formatDate,
  formatDayNumber,
  formatMonthYear,
  formatNullableNumber,
  formatNumber,
  formatWeekday,
  isSameMonth,
  mapPlannerKeywords,
  startOfMonth,
  startOfToday,
} from './planner-utils';
import type { CalendarDay, PlannerArticle } from './types';

const PLANNER_FIXTURES_ALLOWED = process.env.NODE_ENV !== 'production';
const PLANNER_POLL_INTERVAL_MS = 30_000;
// Target Keywords paginates client-side, so the whole pool is fetched one page
// at a time before the table can render. 100 is the API's `limit` cap, which
// halves the sequential round-trips (measured ~1.4s -> ~0.8s for a 191-keyword pool).
const CANDIDATE_PAGE_SIZE = 100;

type StrategyStatus = 'none' | 'pending' | 'completed' | 'failed';

/**
 * Read during the first render rather than from an effect: an effect-gated flag
 * leaves `loading` true for a painted frame on every mount, which flashes even
 * when the planner data is already cached. Outside dev this is a constant
 * `false` on both server and client, so hydration always agrees.
 */
function readFixtureParams() {
  if (!PLANNER_FIXTURES_ALLOWED || typeof window === 'undefined') {
    return { fixturesEnabled: false, pendingPreviewEnabled: false };
  }

  const searchParams = new URLSearchParams(window.location.search);

  return {
    fixturesEnabled: searchParams.get('fixtures') === '1',
    pendingPreviewEnabled: searchParams.get('pending') === '1',
  };
}

export default function ContentPlannerPage() {
  const t = useTranslations('ContentPlannerPage');
  const locale = useLocale();
  const router = useRouter();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const canResearchKeywords = organization?.capabilities?.keyword_research ?? false;
  const canScheduleKeywords = organization?.capabilities?.keyword_scheduling ?? false;
  const queryClient = useQueryClient();
  const pageContentRef = useRef<HTMLDivElement>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const organizationIdRef = useRef(organization?.id);
  const observedStrategyRef = useRef<{
    organizationId: string;
    status: StrategyStatus;
  } | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(startOfToday()));
  const [selectedArticle, setSelectedArticle] = useState<PlannerArticle | null>(null);
  const [chooserDateKey, setChooserDateKey] = useState<string | null>(null);
  const [researchModalOpen, setResearchModalOpen] = useState(false);
  const [{ fixturesEnabled, pendingPreviewEnabled }] = useState(readFixtureParams);
  const [redirecting, setRedirecting] = useState(false);
  const modalOpen = Boolean(selectedArticle) || Boolean(chooserDateKey) || researchModalOpen;

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticle(null);
  }, []);
  const handleCloseResearch = useCallback(() => {
    setResearchModalOpen(false);
  }, []);
  const handleCloseChooser = useCallback(() => {
    setChooserDateKey(null);
  }, []);
  /**
   * Radix returns focus to whatever was focused when *that* dialog opened. That
   * is wrong for a chain: the chooser hands off to research while closing, so
   * research's idea of "before" is a control inside the chooser that is being
   * torn down — and the page is still inert, so the restore lands on <body>.
   *
   * The page owns the chain, so it remembers the control that started it. Only
   * the first dialog records one; the rest of the chain inherits it.
   */
  const rememberReturnFocus = useCallback(() => {
    if (modalReturnFocusRef.current?.isConnected) {
      return;
    }

    modalReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const handleOpenResearch = useCallback(() => {
    setSelectedArticle(null);
    setChooserDateKey(null);
    setResearchModalOpen(true);
  }, []);
  const handleChooseDate = useCallback(
    (dateKey: string) => {
      rememberReturnFocus();
      setSelectedArticle(null);
      setResearchModalOpen(false);
      setChooserDateKey(dateKey);
    },
    [rememberReturnFocus],
  );
  const handlePreviousMonth = useCallback(() => {
    setVisibleMonth((month) => addMonths(month, -1));
  }, []);
  const handleNextMonth = useCallback(() => {
    setVisibleMonth((month) => addMonths(month, 1));
  }, []);
  const handleToday = useCallback(() => {
    setVisibleMonth(startOfMonth(startOfToday()));
  }, []);
  const handleSelectArticle = useCallback(
    (article: PlannerArticle) => {
      rememberReturnFocus();
      setChooserDateKey(null);
      setResearchModalOpen(false);
      setSelectedArticle(article);
    },
    [rememberReturnFocus],
  );

  // Put focus back once the last dialog in a chain closes. This runs after the
  // inert attributes come off, so the target can actually take focus.
  useEffect(() => {
    if (modalOpen) {
      return;
    }

    const trigger = modalReturnFocusRef.current;
    modalReturnFocusRef.current = null;

    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
    }
  }, [modalOpen]);

  useEffect(() => {
    if (organizationIdRef.current === organization?.id) {
      return;
    }

    organizationIdRef.current = organization?.id;
    setVisibleMonth(startOfMonth(startOfToday()));
    setSelectedArticle(null);
    setChooserDateKey(null);
    setResearchModalOpen(false);
  }, [organization?.id]);

  usePageContentInert(pageContentRef, modalOpen);

  const plannerQueryEnabled =
    !fixturesEnabled &&
    !pendingPreviewEnabled &&
    !redirecting &&
    !organizationLoading &&
    !organizationError &&
    Boolean(organization);
  const plannerQuery = useQuery({
    queryKey: dashboardQueryKeys.planner(organization?.id ?? ''),
    queryFn: async () => {
      if (!organization) {
        throw new Error('organization_required');
      }

      const response = await api.api.v0.dashboard.planner.$get({
        query: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('planner_load_failed');
      }

      return response.json();
    },
    enabled: plannerQueryEnabled,
    refetchInterval: (query) =>
      query.state.data?.strategy_status === 'pending' ? PLANNER_POLL_INTERVAL_MS : false,
    staleTime: (query) => (query.state.data?.strategy_status === 'pending' ? 0 : 60 * 60 * 1000),
  });

  useEffect(() => {
    if (!plannerQueryEnabled || !organization || !plannerQuery.data) {
      if (!plannerQueryEnabled) {
        observedStrategyRef.current = null;
      }
      return;
    }

    const currentObservation = {
      organizationId: organization.id,
      status: plannerQuery.data.strategy_status,
    };
    const previousObservation = observedStrategyRef.current;

    if (
      previousObservation?.organizationId === currentObservation.organizationId &&
      previousObservation.status === 'pending' &&
      currentObservation.status !== 'pending'
    ) {
      void queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.home(organization.id),
      });
    }

    observedStrategyRef.current = currentObservation;
  }, [organization, plannerQuery.data, plannerQueryEnabled, queryClient]);

  const candidateQueryEnabled =
    plannerQueryEnabled &&
    plannerQuery.data !== undefined &&
    plannerQuery.data.strategy_status !== 'pending';
  const candidateQuery = useInfiniteQuery({
    queryKey: dashboardQueryKeys.candidatePoolList(
      organization?.id ?? '',
      'candidate',
      CANDIDATE_PAGE_SIZE,
    ),
    queryFn: async ({ pageParam }) => {
      if (!organization) {
        throw new Error('organization_required');
      }

      const response = await api.api.v0.keywords.candidates.$get({
        query: {
          limit: String(CANDIDATE_PAGE_SIZE),
          offset: String(pageParam),
          org_id: organization.id,
          status: 'candidate',
        },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('candidate_pool_load_failed');
      }

      return response.json();
    },
    enabled: candidateQueryEnabled,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
    refetchOnWindowFocus: false,
    staleTime: 60 * 60 * 1000,
  });

  // Target Keywords paginates client-side, so the whole candidate pool has to be in hand.
  useEffect(() => {
    if (
      candidateQuery.hasNextPage &&
      !candidateQuery.isFetchingNextPage &&
      !candidateQuery.isError
    ) {
      void candidateQuery.fetchNextPage();
    }
  }, [
    candidateQuery.fetchNextPage,
    candidateQuery.hasNextPage,
    candidateQuery.isError,
    candidateQuery.isFetchingNextPage,
  ]);

  const today = useMemo(() => startOfToday(), []);
  const plannerArticles = useMemo(() => {
    if (pendingPreviewEnabled) return [];
    if (fixturesEnabled) return createPlannerFixtureArticles();
    if (!plannerQuery.data) return [];

    return mapPlannerKeywords(plannerQuery.data.keywords);
  }, [fixturesEnabled, pendingPreviewEnabled, plannerQuery.data]);
  const strategyStatus: StrategyStatus = pendingPreviewEnabled
    ? 'pending'
    : fixturesEnabled
      ? 'none'
      : (plannerQuery.data?.strategy_status ?? 'none');
  const candidates = useMemo(
    () => candidateQuery.data?.pages.flatMap((page) => page.candidates) ?? [],
    [candidateQuery.data],
  );
  const targetKeywords = useMemo(
    () => combineTargetKeywords(candidates, plannerArticles),
    [candidates, plannerArticles],
  );
  const loadError =
    !fixturesEnabled &&
    !pendingPreviewEnabled &&
    !plannerQuery.data &&
    plannerQuery.isError &&
    !redirecting;
  const loading = redirecting || (plannerQueryEnabled && plannerQuery.isPending);
  const targetKeywordsLoading =
    !fixturesEnabled &&
    !pendingPreviewEnabled &&
    (loading || (candidateQueryEnabled && candidateQuery.isPending));
  const targetKeywordsLoadError =
    candidateQuery.isError && !redirecting && !fixturesEnabled && !pendingPreviewEnabled;
  const researchAvailable =
    Boolean(organization) &&
    !fixturesEnabled &&
    !pendingPreviewEnabled &&
    !redirecting &&
    !organizationLoading &&
    !organizationError;
  const schedulingAvailable =
    candidateQueryEnabled &&
    Boolean(organization) &&
    !fixturesEnabled &&
    !pendingPreviewEnabled &&
    !redirecting &&
    !organizationLoading &&
    !organizationError;
  const calendarWeeks = useMemo(
    () => buildMonthWeeks(visibleMonth, plannerArticles, today),
    [plannerArticles, today, visibleMonth],
  );
  const monthDays = useMemo(
    () => calendarWeeks.flat().filter((day) => day.inMonth),
    [calendarWeeks],
  );
  const isCurrentMonth = isSameMonth(visibleMonth, today);
  const weekdayLabels = useMemo(
    () => calendarWeeks[0]?.map((day) => formatWeekday(day.date, locale, 'short')) ?? [],
    [calendarWeeks, locale],
  );
  const statusMessage = getPlannerStatusMessage({
    loadError,
    loading: loading || organizationLoading,
    organizationError,
    t,
  });

  return (
    <>
      <div ref={pageContentRef} className="grid gap-4">
        {statusMessage ? <StatusMessage message={statusMessage} /> : null}

        {strategyStatus === 'pending' ? (
          <PendingStrategyPanel
            heading={t('status.pendingHeading')}
            supportingText={t('status.pendingSupportingText')}
          />
        ) : strategyStatus === 'failed' ? (
          <FailedStrategyPanel
            heading={t('status.failedHeading')}
            supportingText={t('status.failedSupportingText')}
          />
        ) : (
          <>
            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 className="font-semibold text-base text-foreground">
                  {t('contentCalendar.title')}
                </h2>
                <CalendarMonthNav
                  isCurrentMonth={isCurrentMonth}
                  locale={locale}
                  onNextMonth={handleNextMonth}
                  onPreviousMonth={handlePreviousMonth}
                  onToday={handleToday}
                  t={t}
                  visibleMonth={visibleMonth}
                />
              </div>
              <SummaryPill
                label={t('scheduledCount', { count: plannerArticles.length })}
                value={t('oneArticlePerDay')}
              />
            </header>

            <section
              aria-label={t('calendarLabel')}
              className="hidden overflow-hidden rounded-lg border border-border bg-card md:block"
            >
              <div className="grid grid-cols-7 border-border border-b bg-muted/50">
                {weekdayLabels.map((weekday) => (
                  <div
                    key={weekday}
                    className="px-3 py-2 font-semibold text-muted-foreground text-xs"
                  >
                    {weekday}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarWeeks.flat().map((day) => (
                  <PlannerDayCell
                    canSchedule={canScheduleKeywords}
                    chooserAvailable={schedulingAvailable}
                    key={day.dateKey}
                    day={day}
                    locale={locale}
                    onChooseDate={handleChooseDate}
                    onSelectArticle={handleSelectArticle}
                    t={t}
                  />
                ))}
              </div>
            </section>

            <section aria-label={t('agendaLabel')} className="grid gap-2 md:hidden">
              {monthDays.map((day) => (
                <PlannerAgendaRow
                  canSchedule={canScheduleKeywords}
                  chooserAvailable={schedulingAvailable}
                  key={day.dateKey}
                  day={day}
                  locale={locale}
                  onChooseDate={handleChooseDate}
                  onSelectArticle={handleSelectArticle}
                  t={t}
                />
              ))}
            </section>

            <TargetKeywordsSection
              canResearch={canResearchKeywords}
              loadError={targetKeywordsLoadError}
              loading={targetKeywordsLoading || candidateQuery.isFetchingNextPage}
              onResearch={handleOpenResearch}
              onRetry={() => void candidateQuery.refetch()}
              onUnauthorized={handleUnauthorized}
              organizationId={organization?.id ?? ''}
              researchAvailable={researchAvailable}
              targetKeywords={targetKeywords}
            />
          </>
        )}
      </div>

      <ArticleEditorModal
        article={selectedArticle}
        fixturesEnabled={fixturesEnabled}
        onClose={handleCloseArticle}
        onUnauthorized={handleUnauthorized}
        organizationId={organization?.id ?? ''}
      />
      <ResearchKeywordsModal
        key={organization?.id ?? 'no-organization'}
        canResearch={canResearchKeywords}
        onClose={handleCloseResearch}
        onUnauthorized={handleUnauthorized}
        open={researchModalOpen}
        organizationId={organization?.id ?? ''}
      />
      <ChooseKeywordModal
        key={`${organization?.id ?? 'no-organization'}-${chooserDateKey ?? 'no-date'}`}
        canSchedule={canScheduleKeywords}
        candidates={candidates}
        dateKey={chooserDateKey}
        hasMore={candidateQuery.hasNextPage}
        loadError={targetKeywordsLoadError}
        loading={targetKeywordsLoading}
        loadingMore={candidateQuery.isFetchingNextPage}
        onClose={handleCloseChooser}
        onLoadMore={() => void candidateQuery.fetchNextPage()}
        onOpenResearch={handleOpenResearch}
        onRetry={() => void candidateQuery.refetch()}
        onUnauthorized={handleUnauthorized}
        open={Boolean(chooserDateKey)}
        organizationId={organization?.id ?? ''}
      />
    </>
  );
}

function CalendarMonthNav({
  isCurrentMonth,
  locale,
  onNextMonth,
  onPreviousMonth,
  onToday,
  t,
  visibleMonth,
}: {
  isCurrentMonth: boolean;
  locale: string;
  onNextMonth: () => void;
  onPreviousMonth: () => void;
  onToday: () => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
  visibleMonth: Date;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        aria-label={t('calendarNav.previousMonth')}
        onClick={onPreviousMonth}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      {/* Announced on change so the arrows are not silent for screen readers. */}
      <p aria-live="polite" className="min-w-36 text-center font-medium text-foreground text-sm">
        {formatMonthYear(visibleMonth, locale)}
      </p>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        aria-label={t('calendarNav.nextMonth')}
        onClick={onNextMonth}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-1 h-8"
        disabled={isCurrentMonth}
        onClick={onToday}
      >
        {t('calendarNav.today')}
      </Button>
    </div>
  );
}

function PendingStrategyPanel({
  heading,
  supportingText,
}: {
  heading: string;
  supportingText: string;
}) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="flex h-30 w-full items-center justify-center rounded-lg border border-border bg-card px-6 py-12 text-center"
    >
      <div className="grid justify-items-center gap-2">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <h2 className="font-semibold text-foreground text-base">{heading}</h2>
        <p className="text-muted-foreground text-sm">{supportingText}</p>
      </div>
    </section>
  );
}

function FailedStrategyPanel({
  heading,
  supportingText,
}: {
  heading: string;
  supportingText: string;
}) {
  return (
    <section
      role="alert"
      className="flex h-30 w-full items-center justify-center rounded-lg border border-error-border bg-error-subtle px-6 py-12 text-center"
    >
      <div className="grid justify-items-center gap-2">
        <AlertTriangle className="size-5 text-error" aria-hidden="true" />
        <h2 className="font-semibold text-base text-error">{heading}</h2>
        <p className="text-error text-sm">{supportingText}</p>
      </div>
    </section>
  );
}

function PlannerDayCell({
  canSchedule,
  chooserAvailable,
  day,
  locale,
  onChooseDate,
  onSelectArticle,
  t,
}: {
  canSchedule: boolean;
  chooserAvailable: boolean;
  day: CalendarDay;
  locale: string;
  onChooseDate: (dateKey: string) => void;
  onSelectArticle: (article: PlannerArticle) => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  const cellClassName = cn(
    'flex h-32 min-w-0 flex-col border-border border-r border-b p-2 text-left',
    day.inMonth ? 'bg-card' : 'bg-muted/50 text-muted-foreground',
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              'font-semibold text-foreground text-sm',
              !day.inMonth && 'text-muted-foreground',
            )}
          >
            {formatDayNumber(day.date, locale)}
          </p>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          {day.article && <PlannerStatusBadge article={day.article} t={t} />}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-end">
        {day.article ? (
          <ArticleSummary article={day.article} locale={locale} t={t} />
        ) : day.inMonth && !day.isPast ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-9 w-full justify-start whitespace-normal px-2 py-1.5 text-left text-xs leading-snug"
            aria-label={t(
              canSchedule
                ? 'actions.chooseKeywordForDate'
                : 'actions.chooseKeywordPaidFeatureForDate',
              { date: formatDate(day.date, locale, 'long') },
            )}
            disabled={!chooserAvailable}
            onClick={() => onChooseDate(day.dateKey)}
          >
            <span className="min-w-0">{t('actions.chooseKeyword')}</span>
          </Button>
        ) : null}
      </div>
    </>
  );

  if (day.article) {
    const article = day.article;
    return (
      <button
        type="button"
        className={cn(
          cellClassName,
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        aria-label={t('actions.openArticle', { title: article.title })}
        onClick={() => onSelectArticle(article)}
      >
        {content}
      </button>
    );
  }

  return <div className={cellClassName}>{content}</div>;
}

function PlannerAgendaRow({
  canSchedule,
  chooserAvailable,
  day,
  locale,
  onChooseDate,
  onSelectArticle,
  t,
}: {
  canSchedule: boolean;
  chooserAvailable: boolean;
  day: CalendarDay;
  locale: string;
  onChooseDate: (dateKey: string) => void;
  onSelectArticle: (article: PlannerArticle) => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  const rowClassName = 'grid gap-3 rounded-lg border border-border bg-card p-3 text-left';

  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-muted-foreground text-sm">
            {formatWeekday(day.date, locale, 'long')}
          </p>
          <p className="truncate font-semibold text-foreground text-sm">
            {formatDate(day.date, locale, 'long')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {day.article && <PlannerStatusBadge article={day.article} t={t} />}
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 font-semibold text-foreground text-xs">
            {formatDayNumber(day.date, locale)}
          </span>
        </div>
      </div>

      {day.article ? (
        <ArticleSummary article={day.article} locale={locale} t={t} />
      ) : day.isPast ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-9 w-full justify-start whitespace-normal px-3 py-2 text-left text-sm leading-snug"
          aria-label={t(
            canSchedule
              ? 'actions.chooseKeywordForDate'
              : 'actions.chooseKeywordPaidFeatureForDate',
            { date: formatDate(day.date, locale, 'long') },
          )}
          disabled={!chooserAvailable}
          onClick={() => onChooseDate(day.dateKey)}
        >
          <span className="min-w-0">{t('actions.chooseKeyword')}</span>
        </Button>
      )}
    </>
  );

  if (day.article) {
    const article = day.article;
    return (
      <button
        type="button"
        className={cn(
          rowClassName,
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        aria-label={t('actions.openArticle', { title: article.title })}
        onClick={() => onSelectArticle(article)}
      >
        {content}
      </button>
    );
  }

  return <div className={rowClassName}>{content}</div>;
}

function PlannerStatusBadge({
  article,
  t,
}: {
  article: PlannerArticle;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  if (article.status === 'generated') {
    return <Badge variant="success">{t('statuses.generated')}</Badge>;
  }

  if (article.generationStatus === 'pending') {
    return <Badge variant="info">{t('targetKeywords.statuses.scheduled')}</Badge>;
  }

  if (article.generationStatus === 'generating') {
    return <Badge variant="warning">{t('targetKeywords.statuses.generating')}</Badge>;
  }

  if (article.generationStatus === 'failed') {
    return <Badge variant="error">{t('targetKeywords.statuses.failed')}</Badge>;
  }

  return null;
}

function ArticleSummary({
  article,
  locale,
  t,
}: {
  article: PlannerArticle;
  locale: string;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  return (
    <div className="grid w-full min-w-0 gap-1">
      <span className="line-clamp-2 font-medium text-foreground text-sm leading-snug">
        {article.keyword}
      </span>
      <span className="truncate font-normal text-muted-foreground text-xs">
        {t('metrics.volume')}: {formatNumber(article.volume, locale)}
      </span>
      <span className="truncate font-normal text-muted-foreground text-xs">
        {t('metrics.difficulty')}: {formatNullableNumber(article.difficulty, locale)}
      </span>
    </div>
  );
}

function usePageContentInert(pageContentRef: RefObject<HTMLDivElement | null>, active: boolean) {
  useEffect(() => {
    const pageContent = pageContentRef.current;

    if (!pageContent || !active) {
      return;
    }

    const backgroundElements = [pageContent, ...getAncestorSiblings(pageContent)];
    const previousAttributes = backgroundElements.map((element) => ({
      ariaHidden: element.getAttribute('aria-hidden'),
      element,
      inert: element.hasAttribute('inert'),
    }));

    for (const element of backgroundElements) {
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    }

    return () => {
      for (const { ariaHidden, element, inert } of previousAttributes) {
        if (ariaHidden === null) {
          element.removeAttribute('aria-hidden');
        } else {
          element.setAttribute('aria-hidden', ariaHidden);
        }

        if (!inert) {
          element.removeAttribute('inert');
        }
      }
    };
  }, [active, pageContentRef]);
}

function getAncestorSiblings(element: HTMLElement) {
  const siblings: HTMLElement[] = [];
  let branch = element.parentElement;

  while (branch?.parentElement && branch.parentElement !== document.body) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        siblings.push(sibling);
      }
    }

    branch = branch.parentElement;
  }

  return siblings;
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-muted-foreground text-xs">{label}</p>
        <p className="truncate font-medium text-foreground text-sm">{value}</p>
      </div>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 text-muted-foreground text-sm">
      {message}
    </div>
  );
}

function getPlannerStatusMessage({
  loadError,
  loading,
  organizationError,
  t,
}: {
  loadError: boolean;
  loading: boolean;
  organizationError: ReturnType<typeof useActiveOrganization>['error'];
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  if (loading) return t('status.loading');
  if (organizationError === 'no_organization') return t('status.noOrganization');
  if (organizationError) return t('status.organizationError');
  if (loadError) return t('status.loadError');
  return null;
}
