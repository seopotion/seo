import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { absoluteUrl, SITE_NAME } from '@/lib/seo';
import { formatPostDate, listPosts } from './content';
import { BLOG_LOCALE, blogPath } from './registry';
import { readPostSource } from './source';

const TITLE = 'SEO content, planning and publishing — the Seopotion blog';
const DESCRIPTION =
  'Practical guides on planning SEO content, keeping AI-written articles worth publishing, and shipping them to your site.';

/**
 * English-only, like `/terms` and `/privacy` — so there is no `languages` map
 * here and `/tr/blog` is never generated. When Turkish posts arrive, this gains
 * a `generateMetadata` and `registry.ts` gains a locale per post.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: BLOG_LOCALE }];
}

export const metadata: Metadata = {
  title: 'Blog',
  description: DESCRIPTION,
  alternates: { canonical: '/blog' },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: '/blog' },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default async function BlogIndexPage() {
  const posts = await listPosts();

  const blogJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${SITE_NAME} Blog`,
    description: DESCRIPTION,
    url: absoluteUrl('/blog'),
    inLanguage: BLOG_LOCALE,
    blogPost: posts.map(({ slug, frontmatter }) => ({
      '@type': 'BlogPosting',
      headline: frontmatter.title,
      description: frontmatter.description,
      datePublished: frontmatter.date,
      dateModified: frontmatter.updated ?? frontmatter.date,
      author: { '@type': 'Person', name: frontmatter.author },
      url: absoluteUrl(blogPath(slug)),
    })),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is built from the registry and frontmatter, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }}
        type="application/ld+json"
      />

      <header className="border-border border-b pb-8">
        <p className="mb-2 font-semibold text-amber-600 text-sm">Blog</p>
        <h1 className="font-bold text-3xl text-foreground md:text-4xl">
          Notes on getting found in search
        </h1>
        <p className="mt-3 text-muted-foreground text-lg">{DESCRIPTION}</p>
      </header>

      <ul className="mt-10 grid gap-4">
        {posts.map(({ slug, frontmatter }) => (
          <li key={slug}>
            <Link
              className="block rounded-xl border border-border p-6 no-underline transition-colors hover:border-amber-300 hover:bg-amber-50/40"
              href={blogPath(slug)}
            >
              <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-sm">
                <time dateTime={frontmatter.date}>{formatPostDate(frontmatter.date)}</time>
                <span aria-hidden="true">·</span>
                <span>{readPostSource(slug).readingMinutes} min read</span>
              </p>
              <h2 className="mt-2 font-semibold text-foreground text-xl">{frontmatter.title}</h2>
              <p className="mt-2 text-muted-foreground leading-relaxed">
                {frontmatter.description}
              </p>
              <span className="mt-4 inline-block font-medium text-amber-700 text-sm">
                Read the post →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
