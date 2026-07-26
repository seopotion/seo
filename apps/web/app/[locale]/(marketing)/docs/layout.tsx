import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { DocsNav, type DocsNavSection } from './_components/DocsNav';
import { loadDocsFrontmatter } from './content';
import { docPath, groupedDocs } from './registry';

async function navSections(locale: Locale, groupLabel: (group: string) => string) {
  const sections = groupedDocs();
  const titles = await Promise.all(
    sections.map((section) =>
      loadDocsFrontmatter(
        locale,
        section.entries.map((entry) => entry.slug),
      ),
    ),
  );

  return sections.map<DocsNavSection>((section, index) => ({
    title: groupLabel(section.group),
    items: section.entries.map((entry, entryIndex) => ({
      href: docPath(entry.slug),
      title: titles[index]?.[entryIndex]?.title ?? entry.slug,
    })),
  }));
}

export default async function DocsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Docs' });
  const sections = await navSections(locale as Locale, (group) => t(`groups.${group}`));

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <DocsNav label={t('sidebarLabel')} sections={sections} />
        </aside>
        {children}
      </div>
    </main>
  );
}
