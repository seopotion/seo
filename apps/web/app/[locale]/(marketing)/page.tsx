import type { Metadata } from 'next';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { routeLocale } from '@/i18n/locale';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { languageAlternates, localizedPath, localizedUrl } from '@/i18n/urls';
import { absoluteUrl, SITE_NAME } from '@/lib/seo';

type LandingPageProps = {
  params: Promise<{ locale: Locale }>;
};

type LandingFeature = {
  description: string;
  title: string;
};

type LandingUseCase = {
  name: string;
};

export async function generateMetadata({ params }: LandingPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  const canonical = localizedPath('/', locale);

  return {
    title: {
      absolute: t('defaultTitle'),
    },
    description: t('defaultDescription'),
    alternates: {
      canonical,
      languages: languageAlternates('/'),
    },
  };
}

const features = [
  {
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
  },
  {
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
        />
      </svg>
    ),
  },
  {
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    ),
  },
  {
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
        />
      </svg>
    ),
  },
  {
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
    ),
  },
  {
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
    ),
  },
];

export default function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  // Opts this page into static rendering: without it next-intl resolves the
  // locale from the request, which makes the route render on demand.
  setRequestLocale(routeLocale(use(params).locale));

  const locale = useLocale() as Locale;
  const t = useTranslations('LandingPage');
  const metadataT = useTranslations('Metadata');
  const featureCards = t.raw('features') as LandingFeature[];
  const useCaseCards = t.raw('useCases') as LandingUseCase[];
  const controlCards = t.raw('controls.cards') as LandingFeature[];
  const homeJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: SITE_NAME,
        url: localizedUrl('/', locale),
        logo: absoluteUrl('/android-chrome-192x192.png'),
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: localizedUrl('/', locale),
        description: metadataT('defaultDescription'),
        offers: {
          '@type': 'Offer',
          price: '60',
          priceCurrency: 'USD',
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is serialized from local static data.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }}
      />
      <main className="min-h-screen">
        <section className="relative isolate overflow-hidden px-6 pt-32 pb-20 sm:pt-48">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-96 rotate-180 text-muted-foreground/30 opacity-60 mask-[linear-gradient(to_bottom,transparent,white)]">
            <svg
              aria-hidden="true"
              className="absolute inset-0 h-full w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern
                  id="grid-pattern"
                  width="32"
                  height="32"
                  patternUnits="userSpaceOnUse"
                  x="50%"
                  y="100%"
                  patternTransform="translate(0 -1)"
                >
                  <path d="M0 32V.5H32" fill="none" stroke="currentColor" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid-pattern)" />
            </svg>
          </div>
          <div className="relative z-10 mx-auto max-w-4xl text-center">
            <h1 className="mb-6 font-bold text-4xl text-foreground leading-tight tracking-tight md:text-5xl">
              {t('hero.titleLine1')} <br /> {t('hero.titleLine2')}
            </h1>
            <h2 className="mx-auto mb-8 max-w-2xl text-muted-foreground text-lg">
              {t('hero.subtitle')}
            </h2>
            <Link
              href="/pricing"
              className="inline-flex rounded-lg bg-orange-400 px-5 py-3 font-medium text-sm text-background transition-colors hover:bg-orange-500"
            >
              {t('hero.cta')}
            </Link>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="mx-auto max-w-5xl">
            <div className="relative rounded-2xl bg-linear-to-br from-blue-200 to-purple-200 p-8 md:p-12">
              <div className="grid items-center gap-8 sm:grid-cols-2">
                <div className="overflow-hidden rounded-xl bg-white shadow-xl">
                  <Image
                    src="/hero-image-1.png"
                    alt={t('images.beforeAlt')}
                    width={1105}
                    height={800}
                    loading="eager"
                    sizes="(min-width: 768px) 448px, calc(100vw - 80px)"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 flex rotate-90 sm:rotate-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-400 shadow-lg">
                    <svg
                      aria-hidden="true"
                      className="h-10 w-10 text-background"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 7l5 5m0 0l-5 5m5-5H6"
                      />
                    </svg>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl bg-white shadow-xl">
                  <Image
                    src="/hero-image-2.png"
                    alt={t('images.afterAlt')}
                    width={1105}
                    height={800}
                    loading="eager"
                    fetchPriority="high"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-border border-y bg-muted/50 px-6 py-12">
          <div className="mx-auto max-w-7xl">
            <p className="mb-6 text-center text-muted-foreground">{t('useCasesTitle')}</p>
            <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8">
              {useCaseCards.map((useCase) => (
                <div
                  key={useCase.name}
                  className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm border border-border"
                >
                  <span className="font-medium text-foreground">{useCase.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-16 text-center">
              <h2 className="mb-4 font-bold text-3xl text-foreground md:text-4xl">
                {t('featuresTitle')}
              </h2>
              <p className="mx-auto max-w-5xl text-muted-foreground text-lg">
                {t('featuresDescription')}
              </p>
            </div>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {featureCards.map((feature, index) => (
                <div
                  key={feature.title}
                  className="rounded-2xl bg-muted/50 p-6 transition-shadow hover:shadow-lg"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                    {features[index % features.length]?.icon}
                  </div>
                  <h3 className="mb-2 font-semibold text-foreground text-xl">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* <section className="bg-[#2D3748] px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="font-bold text-3xl text-gray-100 md:text-4xl">
              How to use XXX as a website
            </h2>
          </div>
          <div className="mx-auto grid max-w-5xl gap-8 p-2 md:grid-cols-3 md:gap-20 md:p-8">
            <div>
              <div className="relative mb-6 aspect-4/3 overflow-hidden rounded-2xl border bg-[#EDF2F7]">
                <div className="flex h-full">
                  <div className="w-1/4 space-y-2 bg-[#E2E8F0] p-3">
                    <div className="h-2 w-full rounded bg-gray-300" />
                    <div className="h-2 w-4/5 rounded bg-gray-300" />
                    <div className="h-2 w-full rounded bg-gray-300" />
                    <div className="h-2 w-3/5 rounded bg-[#F6AD55]/80" />
                    <div className="h-2 w-4/5 rounded bg-gray-300" />
                    <div className="h-2 w-full rounded bg-gray-300" />
                  </div>
                  <div className="flex-1 space-y-2 p-4">
                    <div className="mb-3 h-4 w-3/4 rounded bg-gray-300" />
                    <div className="h-2 w-full rounded bg-gray-200" />
                    <div className="h-2 w-5/6 rounded bg-gray-200" />
                    <div className="h-2 w-4/5 rounded bg-gray-200" />
                    <div className="h-2 w-full rounded bg-gray-200" />
                    <div className="h-2 w-2/3 rounded bg-gray-200" />
                    <div className="h-2 w-3/4 rounded bg-gray-200" />
                  </div>
                </div>
                <div className="absolute bottom-3 left-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#F6AD55] shadow-lg">
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </div>
              </div>
              <p className="mb-2 font-medium text-[#F6AD55] text-sm">Step 1</p>
              <h3 className="mb-3 font-bold text-white text-xl">Choose or create a Notion page</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Choose an existing Notion page, create a new one or start with a template. Seo Potion
                works with any Notion page.
              </p>
            </div>

            <div>
              <div className="relative mb-6 aspect-4/3 overflow-hidden rounded-2xl border bg-[#EDF2F7]">
                <div className="flex h-full">
                  <div className="w-1/4 space-y-2 bg-[#E2E8F0] p-3">
                    <div className="h-2 w-full rounded bg-gray-300" />
                    <div className="h-2 w-4/5 rounded bg-gray-300" />
                    <div className="h-2 w-full rounded bg-gray-300" />
                    <div className="h-2 w-3/5 rounded bg-gray-300" />
                    <div className="h-2 w-4/5 rounded bg-gray-300" />
                    <div className="h-2 w-full rounded bg-gray-300" />
                  </div>
                  <div className="flex-1 space-y-2 p-4">
                    <div className="mb-3 h-4 w-3/4 rounded bg-gray-300" />
                    <div className="rounded border border-[#F6AD55]/50 bg-[#F6AD55]/20 p-2">
                      <div className="mb-1 h-2 w-full rounded bg-[#F6AD55]/70" />
                      <div className="h-2 w-4/5 rounded bg-[#F6AD55]/70" />
                    </div>
                    <div className="h-2 w-full rounded bg-gray-200" />
                    <div className="h-2 w-5/6 rounded bg-gray-200" />
                    <div className="h-2 w-2/3 rounded bg-gray-200" />
                  </div>
                </div>
                <div className="absolute bottom-3 left-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#F6AD55] shadow-lg">
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                </div>
              </div>
              <p className="mb-2 font-medium text-[#F6AD55] text-sm">Step 2</p>
              <h3 className="mb-3 font-bold text-white text-xl">
                Paste the Notion page&apos;s web link in Seo Potion
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Publish your Notion page via the Share menu and paste the Notion web link in Seo Potion
                when creating a site.
              </p>
            </div>

            <div>
              <div className="relative mb-6 aspect-4/3 overflow-hidden rounded-2xl border bg-[#EDF2F7]">
                <div className="flex h-full flex-col gap-3 p-4">
                  <div className="mx-auto h-5 w-1/2 rounded-lg bg-[#F6AD55]/60" />
                  <div className="flex gap-2">
                    <div className="h-4 flex-1 rounded bg-gray-300" />
                    <div className="h-4 flex-1 rounded bg-gray-300" />
                    <div className="h-4 flex-1 rounded bg-gray-300" />
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <div className="rounded-lg bg-gray-200" />
                    <div className="rounded-lg bg-gray-200" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 w-full rounded bg-gray-200" />
                    <div className="h-2 w-4/5 rounded bg-gray-200" />
                  </div>
                </div>
                <div className="absolute bottom-3 left-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#F6AD55] shadow-lg">
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                </div>
              </div>
              <p className="mb-2 font-medium text-[#F6AD55] text-sm">Step 3</p>
              <h3 className="mb-3 font-bold text-white text-xl">Share your site with the world</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Your content is now live on a site you can call your own! Edits in Notion are
                automatically synced.
              </p>
            </div>
          </div>
        </div>
      </section> */}

        <section className="px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-16 text-center">
              <h2 className="mb-4 font-bold text-3xl text-foreground md:text-4xl">
                {t('controls.title')}
              </h2>
              <p className="text-muted-foreground text-lg">{t('controls.description')}</p>
            </div>
            <div className="grid gap-8 md:grid-cols-3">
              {controlCards.map((control) => (
                <div key={control.title} className="rounded-2xl border border-border bg-white p-6">
                  <h3 className="font-semibold text-foreground text-xl">{control.title}</h3>
                  <p className="mt-3 text-muted-foreground">{control.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <div className="rounded-2xl bg-linear-to-br from-blue-200 to-purple-200 p-8 text-center text-foreground md:p-12">
              <h2 className="mb-4 font-bold text-3xl md:text-4xl">{t('finalCta.title')}</h2>
              <p className="mx-auto max-w-2xl text-xl">{t('finalCta.description')}</p>
            </div>
          </div>
        </section>

        <section className="border-border border-y bg-muted/50 px-6 py-12">
          <div className="mx-auto max-w-7xl text-center">
            <div className="flex flex-wrap items-center justify-center gap-6">
              <a
                href="https://www.scrolllaunch.com/products/seopotion?ref=badge"
                target="_blank"
                rel="noopener"
                className="inline-flex"
              >
                {/* biome-ignore lint/performance/noImgElement: third-party badge served dynamically by ScrollLaunch, not our origin */}
                <img
                  src="https://www.scrolllaunch.com/api/badge/seopotion"
                  alt="Featured on ScrollLaunch"
                  width={220}
                  height={48}
                  loading="lazy"
                />
              </a>
              <a
                href="https://nicklaunches.com/products/seopotion/?utm_source=seopotion.co&utm_medium=badge&utm_campaign=featured"
                target="_blank"
                rel="noopener"
                className="inline-flex"
              >
                {/* biome-ignore lint/performance/noImgElement: third-party badge served by Nick Launches, not our origin */}
                <img
                  src="https://nicklaunches.com/badges/featured.png"
                  alt="SeoPotion on Nick Launches"
                  width={244}
                  height={56}
                  loading="lazy"
                />
              </a>
              <a
                href="https://thesaasdir.com/product/seopotion?ref=badge"
                rel="dofollow"
                className="inline-flex"
              >
                {/* biome-ignore lint/performance/noImgElement: third-party badge served by TheSaaSDir, not our origin */}
                <img
                  src="https://thesaasdir.com/badge/seopotion.svg"
                  alt="Featured on TheSaaSDir"
                  width={160}
                  height={44}
                />
              </a>
              <a href="https://saascity.io" target="_blank" rel="noopener" className="inline-flex">
                {/* biome-ignore lint/performance/noImgElement: third-party badge served by SaaSCity, not our origin */}
                <img
                  src="https://saascity.io/badges/featured-light.svg"
                  alt="Featured on SaaSCity"
                  width={150}
                  height={54}
                />
              </a>
              <a
                href="https://fazier.com/launches/seopotion.co"
                target="_blank"
                rel="noopener"
                className="inline-flex"
              >
                {/* biome-ignore lint/performance/noImgElement: third-party badge served by Fazier, not our origin */}
                <img
                  src="https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=featured&theme=neutral"
                  width={250}
                  alt="Fazier badge"
                />
              </a>
              <a
                href="https://startupfa.me/s/seopotion?utm_source=seopotion.co"
                target="_blank"
                rel="noopener"
                className="inline-flex"
              >
                {/* biome-ignore lint/performance/noImgElement: third-party badge served by Startup Fame, not our origin */}
                <img
                  src="https://startupfa.me/badges/featured-badge.webp"
                  alt="Seopotion - Featured on Startup Fame"
                  width={171}
                  height={54}
                />
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
