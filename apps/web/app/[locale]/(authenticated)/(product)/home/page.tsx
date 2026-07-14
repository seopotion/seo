'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';

type HomeData = {
  published: number;
  planned: number;
  bestGated: boolean;
  integrations: number;
};

const emptyHomeData: HomeData = {
  published: 0,
  planned: 0,
  bestGated: true,
  integrations: 0,
};

export default function HomePage() {
  const t = useTranslations('HomePage');
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleUnauthorized = useCallback(() => {
    clearToken();
    clearWorkspaceStatusCache();
    router.replace('/');
  }, [router]);

  // Dashboard endpoints are typed via AppType. Change a route schema in
  // apps/api and this file fails to type-check.
  useEffect(() => {
    if (organizationLoading) return;

    let cancelled = false;

    void (async () => {
      setLoading(true);

      try {
        if (organizationError || !organization) {
          setData(emptyHomeData);
          setLoadError(Boolean(organizationError));
          return;
        }

        const [publishedRes, plannedRes, bestRes, integrationsRes] = await Promise.all([
          api.api.v0.dashboard.articles.published.$get({
            query: { org_id: organization.id },
          }),
          api.api.v0.dashboard.articles.planned.$get({
            query: { org_id: organization.id },
          }),
          api.api.v0.dashboard.articles.best.$get(),
          api.api.v0.dashboard.integrations.connected.$get({
            query: { org_id: organization.id },
          }),
        ]);

        if (cancelled) return;

        if (
          [publishedRes, plannedRes, bestRes, integrationsRes].some(
            (response) => (response.status as number) === 401,
          )
        ) {
          handleUnauthorized();
          return;
        }

        setData({
          published: publishedRes.ok ? (await publishedRes.json()).count : 0,
          planned: plannedRes.ok ? (await plannedRes.json()).count : 0,
          bestGated: bestRes.ok ? (await bestRes.json()).gated : true,
          integrations: integrationsRes.ok ? (await integrationsRes.json()).integrations.length : 0,
        });
        setLoadError(Boolean(organizationError));
      } catch {
        if (!cancelled) {
          setData(emptyHomeData);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handleUnauthorized, organization, organizationError, organizationLoading]);

  if (loading) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-slate-600 text-sm">
        {t('loading')}
      </div>
    );
  }

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
              <li>
                {t('recommended.integration')}
                {data?.integrations ? ` ${t('recommended.done')}` : ''}
              </li>
              <li>{t('recommended.keywords')}</li>
              <li>{t('recommended.searchConsole')}</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>{t('bestArticles.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.bestGated ? (
              <p className="text-slate-600 text-sm">{t('bestArticles.gated')}</p>
            ) : (
              <p className="text-slate-600 text-sm">{t('bestArticles.empty')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-semibold text-3xl text-slate-950">{value}</div>
      <div className="mt-1 text-slate-500 text-sm">{label}</div>
    </div>
  );
}
