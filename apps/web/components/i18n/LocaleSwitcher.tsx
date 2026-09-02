'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { type Locale, localeNames, routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export function LocaleSwitcher({ className }: { className?: string }) {
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const t = useTranslations('LocaleSwitcher');

  return (
    <nav
      aria-label={t('label')}
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-md border border-border bg-card p-0.5 text-xs shadow-xs',
        className,
      )}
    >
      {routing.locales.map((locale) => {
        const active = locale === currentLocale;

        return (
          <Link
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex h-7 min-w-9 items-center justify-center rounded-sm px-2 font-semibold transition-colors',
              active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
            )}
            href={pathname}
            key={locale}
            locale={locale}
            title={localeNames[locale]}
          >
            {locale.toUpperCase()}
          </Link>
        );
      })}
    </nav>
  );
}
