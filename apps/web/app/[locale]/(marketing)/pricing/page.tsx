'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { localizedUrl } from '@/i18n/urls';

const TIER_PRICES = [
  {
    id: 'growth',
    monthlyPrice: 80,
    annualPrice: 720,
    listMonthly: null,
    listAnnual: 960,
    highlight: true,
  },
  {
    id: 'expertledgrowth',
    monthlyPrice: 400,
    annualPrice: 3600,
    listMonthly: null,
    listAnnual: 4000,
    highlight: false,
  },
] as const;

type TierContent = {
  cta: string;
  description: string;
  features: string[];
  name: string;
};

type FaqItem = {
  a: string;
  q: string;
};

type ComparisonRow = {
  expert: boolean | string;
  growth: boolean | string;
  label: string;
};

function CellValue({
  includedLabel,
  notIncludedLabel,
  value,
}: {
  includedLabel: string;
  notIncludedLabel: string;
  value: string | boolean;
}) {
  if (value === true) {
    return (
      <svg
        aria-label={includedLabel}
        className="mx-auto h-5 w-5 text-green-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (value === false) {
    return (
      <svg
        aria-label={notIncludedLabel}
        className="mx-auto h-5 w-5 text-gray-300"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    );
  }

  return <>{value}</>;
}

export default function PricingPage() {
  const locale = useLocale() as Locale;
  const t = useTranslations('PricingPage');
  const [annual, setAnnual] = useState(false);
  const tierContent = t.raw('tiers') as Record<(typeof TIER_PRICES)[number]['id'], TierContent>;
  const tiers = TIER_PRICES.map((tier) => ({ ...tier, ...tierContent[tier.id] }));
  const faq = t.raw('faq') as FaqItem[];
  const comparisonRows = t.raw('comparisonRows') as ComparisonRow[];
  const pricingJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
    url: localizedUrl('/pricing', locale),
  };

  return (
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is serialized from local static data.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />
      <div className="mx-auto max-w-6xl px-6 pt-20 pb-24">
        <div className="mb-12 text-center">
          <h1 className="mb-4 font-bold text-4xl text-gray-900 md:text-5xl">{t('title')}</h1>
          <p className="mx-auto max-w-2xl text-gray-600 text-lg">{t('description')}</p>
        </div>

        <div className="mb-10 flex items-center justify-center gap-3">
          <span className={`font-medium text-sm ${annual ? 'text-gray-500' : 'text-gray-900'}`}>
            {t('monthly')}
          </span>
          <button
            type="button"
            onClick={() => setAnnual((value) => !value)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              annual ? 'bg-amber-500' : 'bg-gray-300'
            }`}
            aria-label={t('toggleAnnualBilling')}
            aria-pressed={annual}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                annual ? 'translate-x-5' : ''
              }`}
            />
          </button>
          <span className={`font-medium text-sm ${annual ? 'text-gray-900' : 'text-gray-500'}`}>
            {t('annual')}
            <span className="ml-1 font-semibold text-green-600 text-xs">{t('save')}</span>
          </span>
        </div>

        <div className="mx-auto mb-10 grid max-w-4xl gap-4 md:grid-cols-2">
          {tiers.map((card) => (
            <section
              key={card.id}
              className={`mx-auto flex w-full max-w-90 flex-col rounded-2xl border p-6 ${
                card.highlight
                  ? 'border-amber-400 bg-amber-50/50 shadow-amber-100 shadow-lg'
                  : 'border-gray-200'
              }`}
            >
              {card.highlight && (
                <span className="mb-3 self-start rounded-full bg-amber-400 px-2.5 py-0.5 font-semibold text-white text-xs">
                  {t('mostPopular')}
                </span>
              )}

              <h2 className="font-bold text-gray-900 text-xl">{card.name}</h2>
              <p className="mt-1 mb-4 text-gray-500 text-sm">{card.description}</p>

              <div className="mb-6">
                {card.monthlyPrice !== null ? (
                  <div className="flex items-baseline gap-1.5">
                    {(annual ? card.listAnnual : card.listMonthly) !== null && (
                      <span className="text-gray-400 text-sm line-through">
                        $
                      {annual && card.listAnnual !== null
                        ? Math.round(card.listAnnual / 12)
                        : card.listMonthly}
                      </span>
                    )}
                    <span className="font-bold text-3xl text-gray-900">
                      ${annual ? Math.round(card.annualPrice / 12) : card.monthlyPrice}
                    </span>
                    <span className="text-gray-500 text-sm">/{t('monthShort')}</span>
                  </div>
                ) : (
                  <span className="font-bold text-3xl text-gray-900">{t('free')}</span>
                )}
              </div>

              <ul className="mb-6 flex-1 space-y-2">
                {card.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-gray-700 text-sm">
                    <svg
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href="/"
                className={`block w-full rounded-lg px-4 py-2.5 text-center font-medium text-sm transition-colors ${
                  card.highlight
                    ? 'bg-gray-900 text-white hover:bg-gray-800'
                    : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {card.cta}
              </Link>
            </section>
          ))}
        </div>

        <div className="mb-16 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="font-semibold text-amber-800 text-base">{t('banner.title')}</p>
          <p className="mt-1 text-amber-700 text-sm">{t('banner.description')}</p>
        </div>

        <section className="mb-16">
          <h2 className="mb-8 text-center font-bold text-2xl text-gray-900">
            {t('comparison.title')}
          </h2>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-gray-200 border-b">
                  <th className="w-1/3 px-4 py-3 text-left font-medium text-gray-500">
                    {t('comparison.feature')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-amber-600">Growth</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">
                    {t('comparison.expertLedGrowth')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-gray-100 border-b">
                    <td className="px-4 py-3 text-gray-700">{row.label}</td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      <CellValue
                        includedLabel={t('included')}
                        notIncludedLabel={t('notIncluded')}
                        value={row.growth}
                      />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-900">
                      <CellValue
                        includedLabel={t('included')}
                        notIncludedLabel={t('notIncluded')}
                        value={row.expert}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="md:hidden">
            <summary className="cursor-pointer py-3 text-center font-medium text-gray-700 text-sm hover:text-gray-900">
              {t('comparison.expand')}
            </summary>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-gray-200 border-b">
                  <th className="w-1/3 px-4 py-3 text-left font-medium text-gray-500">
                    {t('comparison.feature')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-amber-600">Growth</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">
                    {t('comparison.expertLedGrowth')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-gray-100 border-b">
                    <td className="px-4 py-3 text-gray-700">{row.label}</td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      <CellValue
                        includedLabel={t('included')}
                        notIncludedLabel={t('notIncluded')}
                        value={row.growth}
                      />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-900">
                      <CellValue
                        includedLabel={t('included')}
                        notIncludedLabel={t('notIncluded')}
                        value={row.expert}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <section className="mb-16">
          <h2 className="mb-8 text-center font-bold text-2xl text-gray-900">{t('faqTitle')}</h2>
          <div className="mx-auto max-w-3xl space-y-4">
            {faq.map((item) => (
              <details key={item.q} className="group rounded-lg border border-gray-200">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-medium text-gray-900 text-sm group-open:text-amber-600">
                  {item.q}
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>
                <p className="px-5 pb-4 text-gray-600 text-sm">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="text-center text-gray-500 text-sm">{t('footerNote')}</p>
      </div>
    </main>
  );
}
