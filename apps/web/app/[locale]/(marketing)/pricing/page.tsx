'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { localizedUrl } from '@/i18n/urls';

const TIER_PRICES = [
  {
    id: 'growth',
    monthlyPrice: 60,
    annualPrice: 540,
    highlight: true,
  },
  {
    id: 'business',
    monthlyPrice: 400,
    annualPrice: 3600,
    highlight: false,
  },
] as const;

type TierContent = {
  clarification?: string;
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
        className="mx-auto h-5 w-5 text-emerald-500"
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
        className="mx-auto h-5 w-5 text-muted-foreground/40"
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
          <h1 className="mb-4 font-bold text-4xl text-foreground md:text-5xl">{t('title')}</h1>
          <p className="mx-auto max-w-2xl text-muted-foreground text-lg">{t('description')}</p>
        </div>

        <div className="mb-10 flex items-center justify-center gap-3">
          <span
            className={`font-medium text-sm ${annual ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {t('monthly')}
          </span>
          <button
            type="button"
            onClick={() => setAnnual((value) => !value)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              annual ? 'bg-amber-500' : 'bg-input'
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
          <span
            className={`font-medium text-sm ${annual ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            {t('annual')}
            <span className="ml-1 font-semibold text-emerald-600 text-xs">{t('save')}</span>
          </span>
        </div>

        <div className="mx-auto mb-10 grid max-w-4xl gap-4 md:grid-cols-2">
          {tiers.map((card) => (
            <section
              key={card.id}
              className={`mx-auto flex w-full max-w-90 flex-col rounded-2xl border p-6 ${
                card.highlight
                  ? 'border-amber-400 bg-amber-50/50 shadow-amber-100 shadow-lg'
                  : 'border-border'
              }`}
            >
              {card.highlight && (
                <span className="mb-3 self-start rounded-full bg-amber-400 px-2.5 py-0.5 font-semibold text-background text-xs">
                  {t('mostPopular')}
                </span>
              )}

              <h2 className="font-bold text-foreground text-xl">{card.name}</h2>
              <p className="mt-1 mb-4 text-muted-foreground text-sm">{card.description}</p>
              {card.clarification ? (
                <p className="-mt-2 mb-4 text-muted-foreground text-xs">{card.clarification}</p>
              ) : null}

              <div className="mb-6">
                {card.monthlyPrice !== null ? (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-bold text-3xl text-foreground">
                        ${annual ? Math.round(card.annualPrice / 12) : card.monthlyPrice}
                      </span>
                      <span className="text-muted-foreground text-sm">/{t('monthShort')}</span>
                    </div>
                    <p
                      aria-hidden={!annual}
                      className={`mt-1 h-4 text-muted-foreground text-xs ${annual ? '' : 'invisible'}`}
                    >
                      {t('annualTotal', {
                        price: card.annualPrice.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US'),
                      })}
                    </p>
                  </>
                ) : (
                  <span className="font-bold text-3xl text-foreground">{t('free')}</span>
                )}
              </div>

              <ul className="mb-6 flex-1 space-y-2">
                {card.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-foreground text-sm">
                    <svg
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
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

              <p className="mb-3 text-center font-medium text-emerald-700 text-xs">
                {t('guarantee')}
              </p>
              <Link
                href="/"
                className={`block w-full rounded-lg px-4 py-2.5 text-center font-medium text-sm transition-colors ${
                  card.highlight
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'border border-border text-foreground hover:bg-muted/50'
                }`}
              >
                {card.cta}
              </Link>
            </section>
          ))}
        </div>

        <section className="mb-16">
          <h2 className="mb-8 text-center font-bold text-2xl text-foreground">
            {t('comparison.title')}
          </h2>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="w-1/3 px-4 py-3 text-left font-medium text-muted-foreground">
                    {t('comparison.feature')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-amber-600">Growth</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    {t('comparison.business')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-border border-b">
                    <td className="px-4 py-3 text-foreground">{row.label}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      <CellValue
                        includedLabel={t('included')}
                        notIncludedLabel={t('notIncluded')}
                        value={row.growth}
                      />
                    </td>
                    <td className="px-4 py-3 text-center text-foreground">
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
            <summary className="cursor-pointer py-3 text-center font-medium text-foreground text-sm hover:text-foreground">
              {t('comparison.expand')}
            </summary>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="w-1/3 px-4 py-3 text-left font-medium text-muted-foreground">
                    {t('comparison.feature')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-amber-600">Growth</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    {t('comparison.business')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-border border-b">
                    <td className="px-4 py-3 text-foreground">{row.label}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      <CellValue
                        includedLabel={t('included')}
                        notIncludedLabel={t('notIncluded')}
                        value={row.growth}
                      />
                    </td>
                    <td className="px-4 py-3 text-center text-foreground">
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
          <h2 className="mb-8 text-center font-bold text-2xl text-foreground">{t('faqTitle')}</h2>
          <div className="mx-auto max-w-3xl space-y-4">
            {faq.map((item) => (
              <details key={item.q} className="group rounded-lg border border-border">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-medium text-foreground text-sm group-open:text-amber-600">
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
                <p className="px-5 pb-4 text-muted-foreground text-sm">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="text-center text-muted-foreground text-sm">{t('footerNote')}</p>
      </div>
    </main>
  );
}
