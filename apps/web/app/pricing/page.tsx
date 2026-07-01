'use client';

import Link from 'next/link';
import { useState } from 'react';
import { absoluteUrl } from '../../lib/seo';

const TIERS = [
  {
    id: 'growth',
    name: 'Growth',
    monthlyPrice: 80,
    annualPrice: 720,
    listMonthly: null,
    listAnnual: 960,
    description: 'AI SEO content engine for growth on auto-pilot.',
    features: [
      '30 Articles a month',
      'Unlimited Users',
      'Auto Keyword Research',
      'Connect to Wordpress, Webflow and more',
      'AI Images',
      'Relevant YouTube videos',
      'Unlimited AI rewrites',
    ],
    highlight: true,
    cta: 'Rank higher on auto-pilot',
  },
  {
    id: 'expertledgrowth',
    name: 'Expert-Led Growth',
    monthlyPrice: 400,
    annualPrice: 3600,
    listMonthly: null,
    listAnnual: 4000,
    description: 'A dedicated SEO expert handles your SEO strategy, execution, and reporting.',
    features: [
      'Everything in Growth',
      'Dedicated SEO expert',
      'SEO strategy and roadmap',
      'Content planning and prioritization',
      'Manual content review and optimization',
      'On-page SEO recommendations',
      'Community and Reddit distribution when relevant',
      'Manual backlink opportunity review',
      'Monthly SEO reporting',
    ],
    cta: 'Talk to an SEO expert',
  },
];

const FAQ = [
  {
    q: 'What is the difference between Growth and Expert-Led Growth?',
    a: 'Growth gives you the AI SEO content engine: keyword research, content generation, CMS publishing, images, relevant YouTube videos, and rewrites. Expert-Led Growth adds a dedicated human SEO expert for strategy, planning, review, optimization recommendations, distribution, backlink opportunity review, and reporting.',
  },
  {
    q: 'Can Seopotion publish to my CMS?',
    a: 'Yes. Growth includes connections to WordPress, Webflow, and more, so Seopotion can help publish finished SEO content directly to your site.',
  },
  {
    q: 'Do I need to do keyword research myself?',
    a: 'No. Growth includes automatic keyword research. On Expert-Led Growth, an SEO expert also helps shape the strategy, roadmap, and content priorities.',
  },
  {
    q: 'Are images and videos included?',
    a: 'Yes. Both plans include AI images and relevant YouTube video suggestions for the content Seopotion creates.',
  },
  {
    q: 'Can I rewrite generated content?',
    a: 'Yes. Both plans include unlimited AI rewrites, so you can keep refining content until it matches your brand and SEO goals.',
  },
  {
    q: 'How does billing work?',
    a: 'You can pay monthly or annually. Annual billing gives you the same plan at a lower effective monthly rate.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Yes. You can move from Growth to Expert-Led Growth when you want a dedicated SEO expert involved in strategy, execution, and reporting.',
  },
];

const COMPARISON_ROWS = [
  { label: 'Articles / month', growth: '30', expert: '30' },
  { label: 'Users', growth: 'Unlimited', expert: 'Unlimited' },
  { label: 'Automatic keyword research', growth: true, expert: true },
  { label: 'CMS publishing integrations', growth: true, expert: true },
  { label: 'AI images', growth: true, expert: true },
  { label: 'Relevant YouTube videos', growth: true, expert: true },
  { label: 'Unlimited AI rewrites', growth: true, expert: true },
  { label: 'Dedicated SEO expert', growth: false, expert: true },
  { label: 'SEO strategy and roadmap', growth: false, expert: true },
  { label: 'Manual content review', growth: false, expert: true },
  { label: 'On-page SEO recommendations', growth: false, expert: true },
  { label: 'Backlink opportunity review', growth: false, expert: true },
  { label: 'Monthly SEO reporting', growth: false, expert: true },
];

const pricingJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.a,
    },
  })),
  url: absoluteUrl('/pricing'),
};

function CellValue({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <svg
        aria-label="Included"
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
        aria-label="Not included"
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
  const [annual, setAnnual] = useState(false);

  return (
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is serialized from local static data.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />
      <div className="mx-auto max-w-6xl px-6 pt-20 pb-24">
        <div className="mb-12 text-center">
          <h1 className="mb-4 font-bold text-4xl text-gray-900 md:text-5xl">
            Pricing for SEO growth
          </h1>
          <p className="mx-auto max-w-2xl text-gray-600 text-lg">
            Choose automated SEO content on autopilot, or add an expert to guide strategy,
            execution, and reporting.
          </p>
        </div>

        <div className="mb-10 flex items-center justify-center gap-3">
          <span className={`font-medium text-sm ${annual ? 'text-gray-500' : 'text-gray-900'}`}>
            Monthly
          </span>
          <button
            type="button"
            onClick={() => setAnnual((value) => !value)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              annual ? 'bg-amber-500' : 'bg-gray-300'
            }`}
            aria-label="Toggle annual billing"
            aria-pressed={annual}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                annual ? 'translate-x-5' : ''
              }`}
            />
          </button>
          <span className={`font-medium text-sm ${annual ? 'text-gray-900' : 'text-gray-500'}`}>
            Annual
            <span className="ml-1 font-semibold text-green-600 text-xs">Save 25%</span>
          </span>
        </div>

        <div className="mx-auto mb-10 grid max-w-4xl gap-4 md:grid-cols-2">
          {TIERS.map((card) => (
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
                  Most popular
                </span>
              )}

              <h2 className="font-bold text-gray-900 text-xl">{card.name}</h2>
              <p className="mt-1 mb-4 text-gray-500 text-sm">{card.description}</p>

              <div className="mb-6">
                {card.monthlyPrice !== null ? (
                  <div className="flex items-baseline gap-1.5">
                    {(annual ? card.listAnnual : card.listMonthly) !== null && (
                      <span className="text-gray-400 text-sm line-through">
                        ${annual ? card.listAnnual : card.listMonthly}
                      </span>
                    )}
                    <span className="font-bold text-3xl text-gray-900">
                      ${annual ? card.annualPrice : card.monthlyPrice}
                    </span>
                    <span className="text-gray-500 text-sm">/{annual ? 'year' : 'mo'}</span>
                  </div>
                ) : (
                  <span className="font-bold text-3xl text-gray-900">Free</span>
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
          <p className="font-semibold text-amber-800 text-base">
            Scale SEO without hiring a full team
          </p>
          <p className="mt-1 text-amber-700 text-sm">
            Start with automated content production, then bring in expert strategy when you want a
            hands-on growth partner.
          </p>
        </div>

        <section className="mb-16">
          <h2 className="mb-8 text-center font-bold text-2xl text-gray-900">Compare plans</h2>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-gray-200 border-b">
                  <th className="w-1/3 px-4 py-3 text-left font-medium text-gray-500">Feature</th>
                  <th className="px-4 py-3 text-center font-medium text-amber-600">Growth</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">
                    Expert-Led Growth
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="border-gray-100 border-b">
                    <td className="px-4 py-3 text-gray-700">{row.label}</td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      <CellValue value={row.growth} />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-900">
                      <CellValue value={row.expert} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="md:hidden">
            <summary className="cursor-pointer py-3 text-center font-medium text-gray-700 text-sm hover:text-gray-900">
              Tap to expand comparison table
            </summary>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-gray-200 border-b">
                  <th className="w-1/3 px-4 py-3 text-left font-medium text-gray-500">Feature</th>
                  <th className="px-4 py-3 text-center font-medium text-amber-600">Growth</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500">
                    Expert-Led Growth
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="border-gray-100 border-b">
                    <td className="px-4 py-3 text-gray-700">{row.label}</td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      <CellValue value={row.growth} />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-900">
                      <CellValue value={row.expert} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <section className="mb-16">
          <h2 className="mb-8 text-center font-bold text-2xl text-gray-900">
            Frequently asked questions
          </h2>
          <div className="mx-auto max-w-3xl space-y-4">
            {FAQ.map((item) => (
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

        <p className="text-center text-gray-500 text-sm">
          Questions? Choose the plan that matches how hands-on you want your SEO growth to be.
        </p>
      </div>
    </main>
  );
}
