'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageDescription,
  PageTitle,
} from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { AnalyticsGatedCard } from '../_components/AnalyticsGatedCard';
import { AnalyticsChartLoading, AnalyticsLoading } from '../_components/AnalyticsLoading';
import type { AnalyticsTimeseries } from '../types';

const AnalyticsChart = dynamic(() => import('../_components/AnalyticsChart'), {
  loading: AnalyticsChartLoading,
  ssr: false,
});

const ANALYTICS_STALE_TIME = 24 * 60 * 60 * 1000;

export default function ArticleAnalyticsPage() {
  const t = useTranslations('AnalyticsPage');
  const router = useRouter();
  const params = useParams<{ articleId?: string | string[] }>();
  const articleId = Array.isArray(params.articleId) ? params.articleId[0] : params.articleId;
  const queryClient = useQueryClient();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const [redirecting, setRedirecting] = useState(false);

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const timeseriesQuery = useQuery({
    queryKey: dashboardQueryKeys.analyticsArticle(organization?.id ?? '', articleId ?? ''),
    queryFn: async (): Promise<AnalyticsTimeseries> => {
      if (!organization || !articleId) throw new Error('article_not_found');

      const response = await api.api.v0.dashboard.analytics.articles[':id'].timeseries.$get({
        param: { id: articleId },
        query: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }
      if (response.status === 404) throw new Error('article_not_found');
      if (response.status !== 200) throw new Error('analytics_timeseries_load_failed');
      return response.json();
    },
    enabled: !redirecting && !organizationLoading && Boolean(organization) && Boolean(articleId),
    staleTime: ANALYTICS_STALE_TIME,
  });

  const loading =
    redirecting ||
    organizationLoading ||
    (Boolean(organization) && Boolean(articleId) && timeseriesQuery.isPending);

  if (loading) return <AnalyticsLoading />;

  const notFound = !articleId || timeseriesQuery.error?.message === 'article_not_found';
  if (organizationError || timeseriesQuery.isError || !organization || !timeseriesQuery.data) {
    return (
      <DetailState
        title={notFound ? t('detail.notFoundTitle') : t('states.errorTitle')}
        message={
          notFound
            ? t('detail.notFound')
            : organizationError === 'no_organization'
              ? t('states.noOrganization')
              : t('states.loadError')
        }
      />
    );
  }

  const data = timeseriesQuery.data;

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Button asChild variant="link" className="mb-2 text-muted-foreground">
            <Link href="/analytics">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('detail.back')}
            </Link>
          </Button>
          <PageTitle>{t('detail.title')}</PageTitle>
          <PageDescription>{t('detail.description')}</PageDescription>
        </div>
        {data.days_live !== null ? (
          <Badge variant="secondary" className="w-fit bg-muted text-foreground">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {t('detail.daysLive', { count: data.days_live })}
          </Badge>
        ) : null}
      </header>

      {data.gated ? (
        <AnalyticsGatedCard />
      ) : data.data_state === 'awaiting' ? (
        <DetailState title={t('detail.awaitingTitle')} message={t('detail.awaitingData')} />
      ) : data.data_state === 'not_published' ? (
        <DetailState title={t('detail.notPublishedTitle')} message={t('detail.notPublished')} />
      ) : data.days_live !== null && data.days_live < 14 ? (
        <DetailState title={t('detail.gatheringTitle')} message={t('detail.stillGathering')} />
      ) : (
        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle>{t('detail.chartTitle')}</CardTitle>
            <p className="text-muted-foreground text-sm">{t('detail.chartDescription')}</p>
          </CardHeader>
          <CardContent>
            <AnalyticsChart series={data.series} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetailState({ message, title }: { message: string; title: string }) {
  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">{message}</CardContent>
    </Card>
  );
}
