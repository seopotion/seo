'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageDescription,
  PageTitle,
} from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { AnalyticsArticleTable } from './_components/AnalyticsArticleTable';
import { AnalyticsGatedCard } from './_components/AnalyticsGatedCard';
import { AnalyticsChartLoading, AnalyticsLoading } from './_components/AnalyticsLoading';
import { AnalyticsSummaryCards } from './_components/AnalyticsSummaryCards';
import type { AnalyticsArticles, AnalyticsRange, AnalyticsScope, AnalyticsSummary } from './types';

const AnalyticsChart = dynamic(() => import('./_components/AnalyticsChart'), {
  loading: AnalyticsChartLoading,
  ssr: false,
});

const ANALYTICS_STALE_TIME = 24 * 60 * 60 * 1000;
const ranges: AnalyticsRange[] = ['7d', '30d', '90d'];
const scopes: AnalyticsScope[] = ['articles', 'site'];

export default function AnalyticsPage() {
  const t = useTranslations('AnalyticsPage');
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [scope, setScope] = useState<AnalyticsScope>('articles');
  const [redirecting, setRedirecting] = useState(false);

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const summaryQuery = useQuery({
    queryKey: dashboardQueryKeys.analyticsSummary(organization?.id ?? '', range, scope),
    queryFn: async (): Promise<AnalyticsSummary> => {
      if (!organization) throw new Error('organization_missing');

      const response = await api.api.v0.dashboard.analytics.summary.$get({
        query: { org_id: organization.id, range, scope },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }
      if (response.status !== 200) throw new Error('analytics_summary_load_failed');
      return response.json();
    },
    enabled: !redirecting && !organizationLoading && Boolean(organization),
    placeholderData: keepPreviousData,
    staleTime: ANALYTICS_STALE_TIME,
  });

  const articlesQuery = useQuery({
    queryKey: dashboardQueryKeys.analyticsArticles(organization?.id ?? '', range),
    queryFn: async (): Promise<AnalyticsArticles> => {
      if (!organization) throw new Error('organization_missing');

      const response = await api.api.v0.dashboard.analytics.articles.$get({
        query: { org_id: organization.id, range },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }
      if (response.status !== 200) throw new Error('analytics_articles_load_failed');
      return response.json();
    },
    enabled: !redirecting && !organizationLoading && Boolean(organization),
    placeholderData: keepPreviousData,
    staleTime: ANALYTICS_STALE_TIME,
  });

  const loading =
    redirecting ||
    organizationLoading ||
    (Boolean(organization) && (summaryQuery.isPending || articlesQuery.isPending));
  const loadError = Boolean(organizationError) || summaryQuery.isError || articlesQuery.isError;

  if (loading) return <AnalyticsLoading />;

  if (loadError || !organization || !summaryQuery.data || !articlesQuery.data) {
    const message =
      organizationError === 'no_organization' ? t('states.noOrganization') : t('states.loadError');
    return <AnalyticsError message={message} />;
  }

  if (summaryQuery.data.gated || articlesQuery.data.gated) {
    return <AnalyticsGatedCard />;
  }

  return (
    <div className="grid gap-6" aria-busy={summaryQuery.isFetching || articlesQuery.isFetching}>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <PageTitle>{t('title')}</PageTitle>
          <PageDescription>{t('description')}</PageDescription>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ToggleGroup
            label={t('controls.scopeLabel')}
            options={scopes}
            selected={scope}
            setSelected={setScope}
            optionLabel={(option) => t(`controls.scopes.${option}`)}
          />
          <ToggleGroup
            label={t('controls.rangeLabel')}
            options={ranges}
            selected={range}
            setSelected={setRange}
            optionLabel={(option) => t(`controls.ranges.${option}`)}
          />
        </div>
      </header>

      <AnalyticsSummaryCards summary={summaryQuery.data} />

      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle>{t('chart.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">{t('chart.description')}</p>
        </CardHeader>
        <CardContent>
          <AnalyticsChart allowMetricToggle series={summaryQuery.data.series} />
        </CardContent>
      </Card>

      <AnalyticsArticleTable key={range} articles={articlesQuery.data.articles} />
    </div>
  );
}

function ToggleGroup<T extends string>({
  label,
  optionLabel,
  options,
  selected,
  setSelected,
}: {
  label: string;
  optionLabel: (option: T) => string;
  options: T[];
  selected: T;
  setSelected: (option: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 font-medium text-muted-foreground text-xs">{label}</legend>
      <div className="flex w-fit rounded-md border border-border bg-card p-1">
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={selected === option ? 'secondary' : 'ghost'}
            aria-pressed={selected === option}
            onClick={() => setSelected(option)}
          >
            {optionLabel(option)}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function AnalyticsError({ message }: { message: string }) {
  const t = useTranslations('AnalyticsPage');

  return (
    <Card className="border-warning-border bg-warning-subtle shadow-none">
      <CardHeader>
        <CardTitle>{t('states.errorTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="text-warning text-sm">{message}</CardContent>
    </Card>
  );
}
