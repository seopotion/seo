'use client';

import { Cable } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Link } from '@/i18n/navigation';

export function AnalyticsGatedCard() {
  const t = useTranslations('AnalyticsPage');

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <span className="flex size-10 items-center justify-center rounded-md bg-success-subtle text-success">
          <Cable className="size-5" aria-hidden="true" />
        </span>
        <CardTitle className="mt-2">{t('gated.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <p className="max-w-2xl text-muted-foreground text-sm">{t('gated.description')}</p>
        <Link
          className="w-fit font-medium text-success text-sm hover:underline"
          href="/settings?tab=googleSearchConsole"
        >
          {t('gated.cta')}
        </Link>
      </CardContent>
    </Card>
  );
}
