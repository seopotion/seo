import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { absoluteUrl, SITE_NAME, SOCIAL_IMAGE } from '@/lib/seo';
import { TableOfContents } from '../_components/TableOfContents';
import { formatPostDate, loadPost, loadPostFrontmatter, postNeighbours } from '../content';
import { BLOG_LOCALE, blogPath, isPostSlug, POST_SLUGS } from '../registry';
import { readPostSource } from '../source';

export const dynamicParams = false;

export function generateStaticParams() {
  return POST_SLUGS.map((slug) => ({ locale: BLOG_LOCALE, slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isPostSlug(slug)) notFound();

  const { title, description, date, updated, author } = await loadPostFrontmatter(slug);
  const canonical = blogPath(slug);

  // `openGraph.images` is deliberately unset: the `opengraph-image` file in
  // this segment generates the card and Next merges it in.
  //
  // `title.absolute` opts out of the root layout's `%s | Seopotion` template.
  // A post title is already written to fill the SERP line — appending 12 more
  // characters only buys a truncated headline, and the 60-char limit the
  // frontmatter test enforces is measured against this string alone. The `/blog`
  // index keeps the template, where "Blog" on its own would be useless.
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    authors: [{ name: author }],
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      publishedTime: date,
      modifiedTime: updated ?? date,
      authors: [author],
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isPostSlug(slug)) notFound();

  const [{ default: Body, frontmatter }, { newer, older }] = await Promise.all([
    loadPost(slug),
    postNeighbours(slug),
  ]);
  const { headings, readingMinutes } = readPostSource(slug);
  const url = absoluteUrl(blogPath(slug));

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: frontmatter.title,
      description: frontmatter.description,
      datePublished: frontmatter.date,
      dateModified: frontmatter.updated ?? frontmatter.date,
      author: { '@type': 'Person', name: frontmatter.author },
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        logo: { '@type': 'ImageObject', url: absoluteUrl(SOCIAL_IMAGE.url) },
      },
      image: absoluteUrl(frontmatter.cover ?? SOCIAL_IMAGE.url),
      inLanguage: BLOG_LOCALE,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { name: SITE_NAME, url: absoluteUrl('/') },
        { name: 'Blog', url: absoluteUrl('/blog') },
        { name: frontmatter.title, url },
      ].map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    },
  ];

  return (
    <>
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is built from the registry and frontmatter, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />

      <nav aria-label="Breadcrumb" className="text-gray-500 text-sm">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link className="no-underline hover:text-gray-900" href="/blog">
              Blog
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-gray-900">{frontmatter.title}</li>
        </ol>
      </nav>

      <header className="mt-4 max-w-3xl border-gray-100 border-b pb-8">
        <h1 className="font-bold text-3xl text-gray-900 md:text-4xl">{frontmatter.title}</h1>
        <p className="mt-3 text-gray-600 text-lg">{frontmatter.description}</p>
        <p className="mt-5 flex flex-wrap items-center gap-x-2 text-gray-500 text-sm">
          <span className="font-medium text-gray-700">{frontmatter.author}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={frontmatter.date}>{formatPostDate(frontmatter.date)}</time>
          <span aria-hidden="true">·</span>
          <span>{readingMinutes} min read</span>
        </p>
      </header>

      {frontmatter.cover ? (
        <div className="relative mt-8 aspect-ratio overflow-hidden rounded-xl border border-gray-200">
          <Image
            alt={frontmatter.coverAlt ?? ''}
            className="object-cover"
            fill
            priority
            sizes="(min-width: 1024px) 1024px, 100vw"
            src={frontmatter.cover}
          />
        </div>
      ) : null}

      <div className="mt-10 gap-12 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem]">
        <article className="max-w-3xl">
          <Body />

          {frontmatter.updated ? (
            <p className="mt-12 text-gray-500 text-sm">
              Last updated {formatPostDate(frontmatter.updated)}
            </p>
          ) : null}

          <aside className="mt-12 rounded-2xl border border-amber-200 bg-amber-50/60 p-6 sm:p-8">
            <h2 className="font-bold text-gray-900 text-xl">Put a month of content on autopilot</h2>
            <p className="mt-2 text-gray-600 leading-relaxed">
              Seopotion scans your site, researches your keywords, plans 30 days of articles, writes
              them, and publishes to WordPress or your own site — with you reviewing whatever you
              want to review.
            </p>
            <Link
              className="mt-5 inline-flex rounded-lg bg-orange-400 px-5 py-3 font-medium text-sm text-white no-underline transition-colors hover:bg-orange-500"
              href="/pricing"
            >
              See plans
            </Link>
          </aside>

          {newer || older ? (
            <nav
              aria-label="More posts"
              className="mt-12 grid gap-3 border-gray-100 border-t pt-6 sm:grid-cols-2"
            >
              {newer ? (
                <Link
                  className="rounded-xl border border-gray-200 p-4 no-underline transition-colors hover:border-amber-300"
                  href={blogPath(newer.slug)}
                >
                  <span className="block text-gray-500 text-xs uppercase tracking-wide">
                    Newer post
                  </span>
                  <span className="mt-1 block font-medium text-gray-900">
                    {newer.frontmatter.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {older ? (
                <Link
                  className="rounded-xl border border-gray-200 p-4 text-right no-underline transition-colors hover:border-amber-300 sm:col-start-2"
                  href={blogPath(older.slug)}
                >
                  <span className="block text-gray-500 text-xs uppercase tracking-wide">
                    Older post
                  </span>
                  <span className="mt-1 block font-medium text-gray-900">
                    {older.frontmatter.title}
                  </span>
                </Link>
              ) : null}
            </nav>
          ) : null}
        </article>

        <div className="order-first mb-10 lg:order-0 lg:mb-0 lg:sticky lg:top-24 lg:self-start">
          <TableOfContents headings={headings} />
        </div>
      </div>
    </>
  );
}
