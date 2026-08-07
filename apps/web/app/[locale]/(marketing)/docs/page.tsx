import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routeLocale } from '@/i18n/locale';
import { Link } from '@/i18n/navigation';
import { languageAlternates, localizedPath } from '@/i18n/urls';
import { loadDocsFrontmatter } from './content';
import { docPath, groupedDocs } from './registry';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = routeLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'DocsMetadata' });
  const canonical = localizedPath('/docs', locale);

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical,
      languages: languageAlternates('/docs'),
    },
    openGraph: {
      title: t('openGraphTitle'),
      description: t('description'),
      url: canonical,
    },
    twitter: {
      title: t('openGraphTitle'),
      description: t('description'),
    },
  };
}

export default async function DocsIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = routeLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Docs' });
  const sections = groupedDocs();
  const frontmatter = await Promise.all(
    sections.map((section) =>
      loadDocsFrontmatter(
        locale,
        section.entries.map((entry) => entry.slug),
      ),
    ),
  );

  return (
    <div className="max-w-3xl">
      <header className="border-gray-100 border-b pb-8">
        <p className="mb-2 font-semibold text-amber-600 text-sm">{t('index.eyebrow')}</p>
        <h1 className="font-bold text-3xl text-gray-900 md:text-4xl">{t('index.title')}</h1>
        <p className="mt-3 text-gray-600 text-lg">{t('index.subtitle')}</p>
      </header>

      {sections.map((section, sectionIndex) => (
        <section className="mt-10" key={section.group}>
          <h2 className="font-semibold text-gray-400 text-xs uppercase tracking-wide">
            {t(`groups.${section.group}`)}
          </h2>
          <ul className="mt-3 grid gap-3">
            {section.entries.map((entry, entryIndex) => {
              const meta = frontmatter[sectionIndex]?.[entryIndex];

              return (
                <li key={entry.slug}>
                  <Link
                    className="block rounded-xl border border-gray-200 p-5 no-underline transition-colors hover:border-amber-300 hover:bg-amber-50/40"
                    href={docPath(entry.slug)}
                  >
                    <span className="block font-semibold text-gray-900">{meta?.title}</span>
                    <span className="mt-1 block text-gray-600 text-sm leading-relaxed">
                      {meta?.description}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
