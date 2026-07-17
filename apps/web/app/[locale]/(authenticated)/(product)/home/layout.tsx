import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'PrivateMetadata' });

  return {
    title: t('home'),
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function HomeLayout({ children }: { children: ReactNode }) {
  return children;
}
