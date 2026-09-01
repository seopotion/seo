'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type DocsNavSection = {
  items: { href: string; title: string }[];
  title: string;
};

/**
 * The only client component in /docs. It exists purely to highlight the current
 * page — layouts cannot read the pathname on the server. Labels arrive already
 * localized, so no message bundle crosses the boundary.
 */
export function DocsNav({ label, sections }: { label: string; sections: DocsNavSection[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="space-y-6">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;

              return (
                <li key={item.href}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-md border-l-2 px-3 py-1.5 text-sm no-underline transition-colors',
                      active
                        ? 'border-amber-500 bg-amber-50 font-medium text-amber-700'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                    href={item.href}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
