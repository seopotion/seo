import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { languageAlternates, localizedPath } from '@/i18n/urls';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'PricingMetadata' });
  const canonical = localizedPath('/pricing', locale);

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical,
      languages: languageAlternates('/pricing'),
    },
    openGraph: {
      title: t('openGraphTitle'),
      description: t('description'),
      url: canonical,
    },
    twitter: {
      title: t('openGraphTitle'),
      description: t('description'),
    },
  };
}

export default function PricingLayout({ children }: { children: ReactNode }) {
  return children;
}
