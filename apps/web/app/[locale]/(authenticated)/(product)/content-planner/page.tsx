'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Search } from 'lucide-react';
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
import { createPlannerFixtureArticles } from './fixtures';
import {
  buildCalendarWeeks,
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
  const queryClient = useQueryClient();
  const pageContentRef = useRef<HTMLDivElement>(null);
  const observedStrategyRef = useRef<{
    organizationId: string;
    status: StrategyStatus;
  } | null>(null);
  const [articleDraftsById, setArticleDraftsById] = useState<Record<string, ArticleEditorDraft>>(
    {},
  );
  const [selectedArticle, setSelectedArticle] = useState<PlannerArticle | null>(null);
  const [fixturesEnabled, setFixturesEnabled] = useState(false);
  const [pendingPreviewEnabled, setPendingPreviewEnabled] = useState(false);
  const [fixturesResolved, setFixturesResolved] = useState(!PLANNER_FIXTURES_ALLOWED);
  const [redirecting, setRedirecting] = useState(false);
  const modalOpen = Boolean(selectedArticle);
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
  const loadError =
    !fixturesEnabled &&
    !pendingPreviewEnabled &&
    !plannerQuery.data &&
    plannerQuery.isError &&
    !redirecting;
  const loading =
    !fixturesResolved || redirecting || (plannerQueryEnabled && plannerQuery.isPending);
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
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-semibold text-lg text-slate-950">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-slate-600 text-sm">{t('description')}</p>
          </div>
          {strategyStatus !== 'pending' ? (
            <SummaryPill
              label={t('scheduledCount', { count: plannerArticles.length })}
              value={t('oneArticlePerDay')}
            />
          ) : null}
        </header>

        {statusMessage ? <StatusMessage message={statusMessage} /> : null}

        {strategyStatus === 'pending' ? (
          <PendingStrategyPanel
            heading={t('status.pendingHeading')}
            supportingText={t('status.pendingSupportingText')}
          />
        ) : (
          <>
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
                    key={day.dateKey}
                    day={day}
                    locale={locale}
                    onSelectArticle={setSelectedArticle}
                    t={t}
                  />
                ))}
              </div>
            </section>

            <section aria-label={t('agendaLabel')} className="grid gap-2 md:hidden">
              {activeDays.map((day) => (
                <PlannerAgendaRow
                  key={day.dateKey}
                  day={day}
                  locale={locale}
                  onSelectArticle={setSelectedArticle}
                  t={t}
                />
              ))}
            </section>
          </>
        )}
      </div>

      <ArticleEditorModal
        article={selectedArticle}
        onClose={() => setSelectedArticle(null)}
        onSaveDraft={handleSaveArticleDraft}
        savedDraft={selectedSavedDraft}
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
  day,
  locale,
  onSelectArticle,
  t,
}: {
  day: CalendarDay;
  locale: string;
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
          >
            <Search className="size-3.5" aria-hidden="true" />
            <span className="min-w-0">{t('actions.researchKeyword')}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PlannerAgendaRow({
  day,
  locale,
  onSelectArticle,
  t,
}: {
  day: CalendarDay;
  locale: string;
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
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="min-w-0">{t('actions.researchKeyword')}</span>
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

    if (!pageContent) {
      return;
    }

    if (!active) {
      pageContent.removeAttribute('aria-hidden');
      pageContent.removeAttribute('inert');
      return;
    }

    pageContent.setAttribute('aria-hidden', 'true');
    pageContent.setAttribute('inert', '');

    return () => {
      pageContent.removeAttribute('aria-hidden');
      pageContent.removeAttribute('inert');
    };
  }, [active, pageContentRef]);
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
