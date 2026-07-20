'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
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
  buildCalendarWeeks,
  combineTargetKeywords,
  formatDate,
  formatDayNumber,
  formatMonth,
  formatNumber,
  formatWeekday,
  isFirstDayOfMonth,
  mapPlannerKeywords,
  startOfToday,
} from './planner-utils';
import type { ArticleEditorDraft, CalendarDay, PlannerArticle } from './types';

const PLANNER_FIXTURES_ALLOWED = process.env.NODE_ENV !== 'production';
const PLANNER_POLL_INTERVAL_MS = 30_000;
const CANDIDATE_PAGE_SIZE = 50;

type StrategyStatus = 'none' | 'pending' | 'completed' | 'failed';

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
  const organizationIdRef = useRef(organization?.id);
  const observedStrategyRef = useRef<{
    organizationId: string;
    status: StrategyStatus;
  } | null>(null);
  const [articleDraftsById, setArticleDraftsById] = useState<Record<string, ArticleEditorDraft>>(
    {},
  );
  const [selectedArticle, setSelectedArticle] = useState<PlannerArticle | null>(null);
  const [chooserDateKey, setChooserDateKey] = useState<string | null>(null);
  const [researchModalOpen, setResearchModalOpen] = useState(false);
  const [fixturesEnabled, setFixturesEnabled] = useState(false);
  const [pendingPreviewEnabled, setPendingPreviewEnabled] = useState(false);
  const [fixturesResolved, setFixturesResolved] = useState(!PLANNER_FIXTURES_ALLOWED);
  const [redirecting, setRedirecting] = useState(false);
  const modalOpen = Boolean(selectedArticle) || Boolean(chooserDateKey) || researchModalOpen;
  const selectedSavedDraft = selectedArticle?.articleId
    ? articleDraftsById[selectedArticle.articleId]
    : undefined;

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const handleSaveArticleDraft = useCallback((draftArticle: ArticleEditorDraft) => {
    setArticleDraftsById((currentDrafts) => ({
      ...currentDrafts,
      [draftArticle.id]: draftArticle,
    }));
  }, []);
  const handleCloseArticle = useCallback(() => {
    setSelectedArticle(null);
  }, []);
  const handleCloseResearch = useCallback(() => {
    setResearchModalOpen(false);
  }, []);
  const handleCloseChooser = useCallback(() => {
    setChooserDateKey(null);
  }, []);
  const handleOpenResearch = useCallback(() => {
    setSelectedArticle(null);
    setChooserDateKey(null);
    setResearchModalOpen(true);
  }, []);
  const handleChooseDate = useCallback((dateKey: string) => {
    setSelectedArticle(null);
    setResearchModalOpen(false);
    setChooserDateKey(dateKey);
  }, []);
  const handleSelectArticle = useCallback((article: PlannerArticle) => {
    setChooserDateKey(null);
    setResearchModalOpen(false);
    setSelectedArticle(article);
  }, []);

  useEffect(() => {
    if (organizationIdRef.current === organization?.id) {
      return;
    }

    organizationIdRef.current = organization?.id;
    setArticleDraftsById({});
    setSelectedArticle(null);
    setChooserDateKey(null);
    setResearchModalOpen(false);
  }, [organization?.id]);

  usePageContentInert(pageContentRef, modalOpen);

  useEffect(() => {
    if (!PLANNER_FIXTURES_ALLOWED) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);

    setFixturesEnabled(searchParams.get('fixtures') === '1');
    setPendingPreviewEnabled(searchParams.get('pending') === '1');
    setFixturesResolved(true);
  }, []);

  const plannerQueryEnabled =
    fixturesResolved &&
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
  const loading =
    !fixturesResolved || redirecting || (plannerQueryEnabled && plannerQuery.isPending);
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
    () => buildCalendarWeeks(today, plannerArticles),
    [plannerArticles, today],
  );
  const activeDays = useMemo(
    () => calendarWeeks.flat().filter((day) => day.inRange),
    [calendarWeeks],
  );
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
        ) : (
          <>
            <TargetKeywordsSection
              canResearch={canResearchKeywords}
              loadError={targetKeywordsLoadError}
              loading={targetKeywordsLoading || candidateQuery.isFetchingNextPage}
              onResearch={handleOpenResearch}
              onRetry={() => void candidateQuery.refetch()}
              researchAvailable={researchAvailable}
              targetKeywords={targetKeywords}
            />

            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="font-semibold text-base text-slate-950">
                {t('contentCalendar.title')}
              </h2>
              <SummaryPill
                label={t('scheduledCount', { count: plannerArticles.length })}
                value={t('oneArticlePerDay')}
              />
            </header>

            <section
              aria-label={t('calendarLabel')}
              className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block"
            >
              <div className="grid grid-cols-7 border-slate-200 border-b bg-slate-50">
                {weekdayLabels.map((weekday) => (
                  <div key={weekday} className="px-3 py-2 font-semibold text-slate-600 text-xs">
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
              {activeDays.map((day) => (
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
          </>
        )}
      </div>

      <ArticleEditorModal
        article={selectedArticle}
        onClose={handleCloseArticle}
        onSaveDraft={handleSaveArticleDraft}
        savedDraft={selectedSavedDraft}
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
      className="flex h-30 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-12 text-center"
    >
      <div className="grid justify-items-center gap-2">
        <LoaderCircle className="size-5 animate-spin text-slate-500" aria-hidden="true" />
        <h2 className="font-semibold text-slate-950 text-base">{heading}</h2>
        <p className="text-slate-600 text-sm">{supportingText}</p>
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
  return (
    <div
      className={cn(
        'flex h-36 min-w-0 flex-col border-slate-200 border-r border-b p-2',
        day.inRange ? 'bg-white' : 'bg-slate-50 text-slate-400',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              'truncate font-medium text-slate-600 text-xs',
              !day.inRange && 'text-slate-400',
            )}
          >
            {formatWeekday(day.date, locale, 'short')}
          </p>
          <p
            className={cn('font-semibold text-slate-950 text-sm', !day.inRange && 'text-slate-400')}
          >
            {formatDayNumber(day.date, locale)}
          </p>
        </div>
        {isFirstDayOfMonth(day.date) && (
          <span className="truncate text-slate-500 text-xs">{formatMonth(day.date, locale)}</span>
        )}
      </div>

      <div className="mt-3 flex min-h-0 flex-1 items-end">
        {day.article ? (
          <ArticleButton
            article={day.article}
            locale={locale}
            onSelectArticle={onSelectArticle}
            t={t}
          />
        ) : day.inRange ? (
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
    </div>
  );
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
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-600 text-sm">
            {formatWeekday(day.date, locale, 'long')}
          </p>
          <p className="truncate font-semibold text-slate-950 text-sm">
            {formatDate(day.date, locale, 'long')}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700 text-xs">
          {formatDayNumber(day.date, locale)}
        </span>
      </div>

      {day.article ? (
        <ArticleButton
          article={day.article}
          locale={locale}
          onSelectArticle={onSelectArticle}
          t={t}
        />
      ) : (
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
    </div>
  );
}

function ArticleButton({
  article,
  locale,
  onSelectArticle,
  t,
}: {
  article: PlannerArticle;
  locale: string;
  onSelectArticle: (article: PlannerArticle) => void;
  t: ReturnType<typeof useTranslations<'ContentPlannerPage'>>;
}) {
  return (
    <button
      type="button"
      className="grid w-full min-w-0 gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-left transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('actions.openArticle', { title: article.title })}
      onClick={() => onSelectArticle(article)}
    >
      <span className="line-clamp-2 font-semibold text-slate-950 text-sm leading-snug">
        {article.keyword}
      </span>
      <span className="truncate font-normal text-slate-600 text-xs">
        {t('metrics.volume')}: {formatNumber(article.volume, locale)}
      </span>
      <span className="truncate font-normal text-slate-600 text-xs">
        {t('metrics.difficulty')}: {formatNumber(article.difficulty, locale)}
      </span>
    </button>
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
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-slate-500 text-xs">{label}</p>
        <p className="truncate font-medium text-slate-950 text-sm">{value}</p>
      </div>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-600 text-sm">
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
