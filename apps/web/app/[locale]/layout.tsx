import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { languageAlternates } from '@/i18n/urls';
import { SITE_NAME, SOCIAL_IMAGE } from '@/lib/seo';

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * Namespaces reachable from a `'use client'` component. Everything else —
 * metadata namespaces, the landing page, the navbar, docs chrome — renders on
 * the server, so serializing it into every page's payload buys nothing.
 * Adding `useTranslations` to a client component means adding its namespace here.
 */
const CLIENT_NAMESPACES = [
  'ArticleDetailPage',
  'ArticleSettingsPage',
  'AuthGuard',
  'BillingPage',
  'ContentHistoryPage',
  'ContentPlannerPage',
  'GoogleJoinButton',
  'GscCallback',
  'HomePage',
  'LocaleSwitcher',
  'Onboarding',
  'PricingPage',
  'ProductShell',
  'SettingsPage',
] as const;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Pick<LocaleLayoutProps, 'params'>) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: 'Metadata' });

  return {
    applicationName: SITE_NAME,
    title: {
      default: t('defaultTitle'),
      template: `%s | ${SITE_NAME}`,
    },
    description: t('defaultDescription'),
    keywords: t.raw('keywords') as string[],
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    alternates: {
      canonical: '/',
      languages: languageAlternates('/'),
    },
    openGraph: {
      type: 'website',
      locale: t('openGraphLocale'),
      siteName: SITE_NAME,
      title: t('defaultTitle'),
      description: t('defaultDescription'),
      url: '/',
      images: [{ ...SOCIAL_IMAGE, alt: t('socialImageAlt') }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('defaultTitle'),
      description: t('defaultDescription'),
      images: [SOCIAL_IMAGE.url],
    },
  } satisfies Metadata;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages({ locale });
  const clientMessages = Object.fromEntries(
    CLIENT_NAMESPACES.map((namespace) => [namespace, messages[namespace]]),
  );

  return <NextIntlClientProvider messages={clientMessages}>{children}</NextIntlClientProvider>;
}
