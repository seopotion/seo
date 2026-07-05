import type { Metadata } from 'next';
import Image from 'next/image';
import { WishlistForm } from '../../components/WishlistForm';
import { absoluteUrl, DEFAULT_DESCRIPTION, DEFAULT_TITLE, SITE_NAME } from '../../lib/seo';

export const metadata: Metadata = {
  title: {
    absolute: DEFAULT_TITLE,
  },
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: '/',
  },
};

const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: SITE_NAME,
      url: absoluteUrl('/'),
      logo: absoluteUrl('/android-chrome-192x192.png'),
    },
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: absoluteUrl('/'),
      description: DEFAULT_DESCRIPTION,
      offers: {
        '@type': 'Offer',
        price: '80',
        priceCurrency: 'USD',
      },
    },
  ],
};

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
    title: 'Smart Keyword Research',
    description:
      'We find the best search terms to bring real buyers to your website, not just empty traffic.',
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
    title: 'On-Brand Content',
    description:
      "We write engaging blog posts that perfectly match your brand's unique voice and style.",
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
    title: 'Quality Backlink Building',
    description:
      'We secure trusted links from other websites to push your domain higher in search results.',
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
    title: 'AI Search Optimization',
    description:
      'We structure your content so that ChatGPT and other AI models recommend your brand to users.',
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
    title: 'Seamless CMS Publishing',
    description:
      'We handle all internal linking and publish the finished articles directly to your blog for you.',
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
    title: 'Continuous SEO Tuning',
    description:
      'We track your search rankings daily and tweak our strategy to keep your traffic growing.',
  },
];

const useCases = [
  { name: 'Indie Developers & Solopreneurs' },
  { name: 'Startups' },
  { name: 'Small Business Owners' },
  { name: 'Anyone wants to be visible on web' },
];

const testimonials = [
  {
    quote:
      "This tool transformed how I handle SEO. I just connected my WordPress, approved a few topics, and it automated my entire content calendar. It's magical.",
    author: 'Melisa Ozturk',
    role: 'Indie Developer',
  },
  {
    quote:
      'We put our entire content pipeline on autopilot. The team loves how it instantly learns the brand voice, and we love the steady growth in organic traffic.',
    author: 'Marcus Johnson',
    role: 'Agency Owner',
  },
  {
    quote:
      "Finally, an SEO solution that doesn't require me to spend hours doing keyword research or writing drafts. It scanned my site and took care of the rest perfectly.",
    author: 'Emily Rodriguez',
    role: 'SaaS Founder',
  },
];

const starKeys = ['star-1', 'star-2', 'star-3', 'star-4', 'star-5'];

function LogoMark() {
  return (
    <div className="flex items-center gap-2">
      <Image src="/android-chrome-192x192.png" alt="Seopotion logo" width={32} height={32} />
      <span className="text-2xl font-bold text-gray-900">Seopotion</span>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is serialized from local static data.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }}
      />
      <section className="relative isolate overflow-hidden px-6 pt-32 pb-20 sm:pt-48">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-96 rotate-180 text-gray-500/30 opacity-60 mask-[linear-gradient(to_bottom,transparent,white)]">
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
          <h1 className="mb-6 font-bold text-4xl text-gray-800 leading-tight tracking-tight md:text-5xl">
            Stand Out on <br /> Google and ChatGPT
          </h1>
          <h2 className="mx-auto mb-10 max-w-2xl text-gray-600 text-lg">
            We make your brand show up on both Google and Chatgpt, on autopilot.
          </h2>
          <WishlistForm source="landing_hero" />
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl">
          <div className="relative rounded-2xl bg-linear-to-br from-blue-200 to-purple-200 p-8 md:p-12">
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div className="overflow-hidden rounded-xl bg-white shadow-xl">
                <Image
                  src="/hero-image-1.png"
                  alt="google search console befores"
                  width={1754}
                  height={1256}
                  loading="eager"
                  sizes="(min-width: 768px) 448px, calc(100vw - 80px)"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="absolute top-1/2 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-400 shadow-lg">
                  <svg
                    aria-hidden="true"
                    className="h-10 w-10 text-white"
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
                  alt="google search console after"
                  width={1754}
                  height={1255}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-gray-100 border-y bg-gray-50 px-6 py-12">
        <div className="mx-auto max-w-7xl">
          <p className="mb-6 text-center text-gray-500">Perfect for</p>
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8">
            {useCases.map((useCase) => (
              <div
                key={useCase.name}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm border border-gray-200"
              >
                <span className="font-medium text-gray-700">{useCase.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-24 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl text-gray-900 md:text-4xl">
              Everything you need for SEO
            </h2>
            <p className="mx-auto max-w-5xl text-gray-600 text-lg">
              We handle all steps you need to rank higher in Google searchs and be mentioned by
              Chatgpt and other llms{' '}
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl bg-gray-50 p-6 transition-shadow hover:shadow-lg"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                  {feature.icon}
                </div>
                <h3 className="mb-2 font-semibold text-gray-900 text-xl">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
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
                Choose an existing Notion page, create a new one or start with a template. Sparkie
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
                Paste the Notion page&apos;s web link in Sparkie
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Publish your Notion page via the Share menu and paste the Notion web link in Sparkie
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
            <h2 className="mb-4 font-bold text-3xl text-gray-900 md:text-4xl">Loved by users</h2>
            <p className="text-gray-600 text-lg">Join others who&apos;ve simplified their SEO.</p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <div
                key={testimonial.author}
                className="rounded-2xl border border-gray-100 bg-white p-6"
              >
                <div className="mb-4 flex gap-1 text-yellow-400">
                  {starKeys.map((starKey) => (
                    <svg
                      key={starKey}
                      aria-hidden="true"
                      className="h-5 w-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="mb-6 text-gray-700">&ldquo;{testimonial.quote}&rdquo;</p>
                <div>
                  <p className="font-semibold text-gray-900">{testimonial.author}</p>
                  <p className="text-gray-500 text-sm">{testimonial.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl bg-linear-to-br from-blue-200 to-purple-200 p-8 text-center text-gray-700 md:p-12">
            <h2 className="mb-4 font-bold text-3xl md:text-4xl">Ready to Boost your SEO?</h2>
            <p className="mx-auto mb-8 max-w-2xl text-xl">
              Join startups, agencies and teams who use Seopotion to scale their SEO without hiring
              a marketing team.
            </p>
            <WishlistForm source="landing_final_cta" />
          </div>
        </div>
      </section>

      <footer className="border-gray-100 border-t px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <LogoMark />
            <div className="flex items-center gap-8 text-gray-600">
              <a href="#features" className="transition-colors hover:text-gray-900">
                Features
              </a>
              <a href="/pricing" className="transition-colors hover:text-gray-900">
                Pricing
              </a>
              <a href="/blog" className="transition-colors hover:text-gray-900">
                Blog
              </a>
              <a href="/guides" className="transition-colors hover:text-gray-900">
                Support
              </a>
            </div>
            <p className="text-gray-500 text-sm">&copy; 2026 Seopotion. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
