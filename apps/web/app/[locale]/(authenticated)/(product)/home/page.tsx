'use client';

import type { StrategyStatus } from '@shared/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { startOfToday, toDateKey } from '../content-planner/planner-utils';
import type { PlannerKeywordResponse } from '../content-planner/types';
import { type RecommendedAction, recommendedActions } from './home-utils';

const SETTINGS_GSC_HREF = '/settings?tab=googleSearchConsole';

type BestArticle = { url: string; clicks: number; title: string | null };

type HomeData = {
  published: number;
  planned: number;
  best: { gated: boolean; articles: BestArticle[] };
  perf: {
    gated: boolean;
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    position: number | null;
  };
  strategyStatus: StrategyStatus;
  keywords: PlannerKeywordResponse[];
};

const emptyHomeData: HomeData = {
  published: 0,
  planned: 0,
  best: { gated: true, articles: [] },
  perf: { gated: true, clicks: null, impressions: null, ctr: null, position: null },
  strategyStatus: 'none',
  keywords: [],
};

export default function HomePage() {
  const t = useTranslations('HomePage');
  const locale = useLocale();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleUnauthorized = useCallback(() => {
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  // Dashboard endpoints are typed via AppType. Change a route schema in
  // apps/api and this file fails to type-check.
  const homeQuery = useQuery({
    queryKey: dashboardQueryKeys.home(organization?.id ?? ''),
    queryFn: async (): Promise<HomeData> => {
      if (!organization) return emptyHomeData;

      const [publishedRes, plannedRes, bestRes, perfRes, plannerRes] = await Promise.all([
        api.api.v0.dashboard.articles.published.$get({
          query: { org_id: organization.id },
        }),
        api.api.v0.dashboard.articles.planned.$get({
          query: { org_id: organization.id },
        }),
        api.api.v0.dashboard.articles.best.$get({
          query: { org_id: organization.id },
        }),
        api.api.v0.dashboard['search-performance'].$get({
          query: { org_id: organization.id },
        }),
        api.api.v0.dashboard.planner.$get({
          query: { org_id: organization.id },
        }),
      ]);

      if (
        [publishedRes, plannedRes, bestRes, perfRes, plannerRes].some(
          (response) => (response.status as number) === 401,
        )
      ) {
        handleUnauthorized();
        return emptyHomeData;
      }

      const planner = plannerRes.ok ? await plannerRes.json() : null;

      return {
        published: publishedRes.ok ? (await publishedRes.json()).count : 0,
        planned: plannedRes.ok ? (await plannedRes.json()).count : 0,
        best: bestRes.status === 200 ? await bestRes.json() : emptyHomeData.best,
        perf: perfRes.status === 200 ? await perfRes.json() : emptyHomeData.perf,
        strategyStatus: planner?.strategy_status ?? 'none',
        keywords: planner?.keywords ?? [],
      };
    },
    enabled: !organizationLoading && Boolean(organization),
    staleTime: 60 * 60 * 1000,
  });
  const data = homeQuery.data ?? emptyHomeData;
  const loadError = Boolean(organizationError) || homeQuery.isError;
  const loading = organizationLoading || (Boolean(organization) && homeQuery.isPending);

  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }),
    [locale],
  );

  if (loading) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-slate-600 text-sm">
        {t('loading')}
      </div>
    );
  }

  const actions = recommendedActions({
    bestGated: data.best.gated,
    // Default to "entitled" so a missing org never shows a spurious upgrade nudge.
    keywordResearch: organization?.capabilities.keyword_research ?? true,
    keywords: data.keywords,
    planned: data.planned,
    published: data.published,
    strategyStatus: data.strategyStatus,
    today: toDateKey(startOfToday()),
  });

  return (
    <div>
      {loadError && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          {t('loadError')}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>{t('articles.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-8">
              <Stat label={t('articles.published')} value={data?.published ?? 0} />
              <Stat label={t('articles.planned')} value={data?.planned ?? 0} />
            </div>
            <p className="mt-4 text-emerald-700 text-sm">{t('articles.cta')}</p>
          </CardContent>
        </Card>

        {/*
        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>{t('backlinks.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 text-sm">{t('backlinks.description')}</p>
            <button
              type="button"
              disabled
              className="mt-4 rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-400 text-sm"
            >
              {t('backlinks.upgrade')}
            </button>
          </CardContent>
        </Card>
        */}

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>{t('recommended.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-slate-600 text-sm">
              {actions.map((action) => (
                <li key={action.key}>
                  <ActionLabel action={action} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>{t('bestArticles.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.best.gated ? (
              <GatedCard message={t('bestArticles.gated')} cta={t('bestArticles.gatedCta')} />
            ) : data.best.articles.length === 0 ? (
              <p className="text-slate-600 text-sm">{t('bestArticles.empty')}</p>
            ) : (
              <div className="grid gap-3">
                <p className="text-slate-500 text-xs">{t('bestArticles.subtitle')}</p>
                <ul className="grid gap-2">
                  {data.best.articles.slice(0, 5).map((article) => (
                    <li
                      key={article.url}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-slate-700 hover:text-slate-950 hover:underline"
                      >
                        {article.title ?? pathLabel(article.url)}
                      </a>
                      <span className="shrink-0 text-slate-500 tabular-nums">
                        {t('bestArticles.clicks', { count: article.clicks })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>{t('searchPerformance.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.perf.gated ? (
              <GatedCard
                message={t('searchPerformance.gated')}
                cta={t('searchPerformance.gatedCta')}
              />
            ) : (
              <div className="grid gap-3">
                <p className="text-slate-500 text-xs">{t('searchPerformance.subtitle')}</p>
                <div className="grid grid-cols-2 gap-4">
                  <Stat
                    label={t('searchPerformance.clicks')}
                    value={numberFormat.format(Math.round(data.perf.clicks ?? 0))}
                  />
                  <Stat
                    label={t('searchPerformance.impressions')}
                    value={numberFormat.format(Math.round(data.perf.impressions ?? 0))}
                  />
                  <Stat
                    label={t('searchPerformance.ctr')}
                    value={percentFormat.format(data.perf.ctr ?? 0)}
                  />
                  <Stat
                    label={t('searchPerformance.position')}
                    value={(data.perf.position ?? 0).toFixed(1)}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Path-based label for a GSC page URL: pathname, host for the root page, raw string on failure. */
function pathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' ? parsed.hostname : parsed.pathname;
  } catch {
    return url;
  }
}

function GatedCard({ cta, message }: { cta: string; message: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-slate-600 text-sm">{message}</p>
      <Link className="text-emerald-700 text-sm hover:underline" href={SETTINGS_GSC_HREF}>
        {cta}
      </Link>
    </div>
  );
}

function ActionLabel({ action }: { action: RecommendedAction }) {
  const t = useTranslations('HomePage.recommended.actions');
  const label = t(action.key, { count: action.count ?? 0 });

  if (!action.href) {
    return <>{label}</>;
  }

  return (
    <Link className="text-emerald-700 hover:underline" href={action.href}>
      {label}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="font-semibold text-3xl text-slate-950">{value}</div>
      <div className="mt-1 text-slate-500 text-sm">{label}</div>
    </div>
  );
}
