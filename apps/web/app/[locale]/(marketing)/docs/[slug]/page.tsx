import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { routeLocale } from '@/i18n/locale';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { languageAlternates, localizedPath } from '@/i18n/urls';
import { absoluteUrl } from '@/lib/seo';
import { loadDoc, loadDocFrontmatter } from '../content';
import { DOC_SLUGS, docNeighbours, docPath, findDoc } from '../registry';

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => DOC_SLUGS.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  if (!findDoc(slug)) notFound();

  const locale = routeLocale(rawLocale);

  const { title, description } = await loadDocFrontmatter(locale, slug);
  const path = docPath(slug);
  const canonical = localizedPath(path, locale);

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: languageAlternates(path),
    },
    openGraph: { title, description, url: canonical },
    twitter: { title, description },
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = routeLocale(rawLocale);
  setRequestLocale(locale);

  const entry = findDoc(slug);
  if (!entry) notFound();

  const [t, format, { default: Body, frontmatter }] = await Promise.all([
    getTranslations({ locale, namespace: 'Docs' }),
    getFormatter({ locale }),
    loadDoc(locale, slug),
  ]);

  const groupLabel = t(`groups.${entry.group}`);
  const { previous, next } = docNeighbours(slug);
  const [previousMeta, nextMeta] = await Promise.all([
    previous ? loadDocFrontmatter(locale, previous.slug) : null,
    next ? loadDocFrontmatter(locale, next.slug) : null,
  ]);

  // Flat URLs give up the hierarchy signal that nested paths carry; the
  // BreadcrumbList restores it. The group is a label, not a route, so it
  // points back at the index.
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: t('home'), url: absoluteUrl(localizedPath('/docs', locale)) },
      { name: groupLabel, url: absoluteUrl(localizedPath('/docs', locale)) },
      { name: frontmatter.title, url: absoluteUrl(localizedPath(docPath(slug), locale)) },
    ].map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <article className="max-w-3xl">
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is built from the registry and frontmatter, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        type="application/ld+json"
      />

      <nav aria-label={t('breadcrumbLabel')} className="text-muted-foreground text-sm">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link className="no-underline hover:text-foreground" href="/docs">
              {t('home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>{groupLabel}</li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">{frontmatter.title}</li>
        </ol>
      </nav>

      <header className="mt-4 border-border border-b pb-8">
        <h1 className="font-bold text-3xl text-foreground md:text-4xl">{frontmatter.title}</h1>
        <p className="mt-3 text-muted-foreground text-lg">{frontmatter.description}</p>
      </header>

      <div className="mt-10">
        <Body />
      </div>

      <p className="mt-12 text-muted-foreground text-sm">
        {t('updated', {
          date: format.dateTime(new Date(frontmatter.updated), { dateStyle: 'long' }),
        })}
      </p>

      {previous || next ? (
        <nav
          aria-label={t('pagerLabel')}
          className="mt-6 grid gap-3 border-border border-t pt-6 sm:grid-cols-2"
        >
          {previous && previousMeta ? (
            <Link
              className="rounded-xl border border-border p-4 no-underline transition-colors hover:border-amber-300"
              href={docPath(previous.slug)}
            >
              <span className="block text-muted-foreground text-xs uppercase tracking-wide">
                {t('previous')}
              </span>
              <span className="mt-1 block font-medium text-foreground">{previousMeta.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && nextMeta ? (
            <Link
              className="rounded-xl border border-border p-4 text-right no-underline transition-colors hover:border-amber-300 sm:col-start-2"
              href={docPath(next.slug)}
            >
              <span className="block text-muted-foreground text-xs uppercase tracking-wide">
                {t('next')}
              </span>
              <span className="mt-1 block font-medium text-foreground">{nextMeta.title}</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </article>
  );
}
