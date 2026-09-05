'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BarChart3,
  CreditCard,
  FileSliders,
  Home,
  LayoutList,
  // Link2,
  LogOut,
  // Megaphone,
  Settings,
  Sparkles,
} from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher';
import { Button } from '@/components/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { clearToken } from '@/lib/auth';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';
import { OrganizationSwitcher } from './OrganizationSwitcher';

const navItems = [
  { href: '/home', key: 'home', icon: Home },
  {
    href: '/content-planner',
    key: 'contentPlanner',
    icon: LayoutList,
  },
  {
    href: '/content-history',
    key: 'contentHistory',
    icon: Archive,
  },
  {
    href: '/article-settings',
    key: 'articleSettings',
    icon: FileSliders,
  },
  {
    href: '/article-improvements',
    key: 'articleImprovements',
    icon: Sparkles,
  },
  // {
  //   href: '/backlinks',
  //   key: 'backlinks',
  //   icon: Link2,
  // },
  // {
  //   href: '/ads',
  //   key: 'ads',
  //   icon: Megaphone,
  // },
  {
    href: '/analytics',
    key: 'analytics',
    icon: BarChart3,
  },
  {
    href: '/billing',
    key: 'billing',
    icon: CreditCard,
  },
  {
    href: '/settings',
    key: 'settings',
    icon: Settings,
  },
] as const;

const productShellStyle = {
  '--product-sidebar-width': '13.5rem',
} as CSSProperties;

export function ProductShell({ children }: { children: ReactNode }) {
  const t = useTranslations('ProductShell');
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { organization } = useActiveOrganization();
  const activeItem =
    navItems.find((item) => item.href === pathname || pathname.startsWith(`${item.href}/`)) ??
    navItems[0];
  const isHome = pathname === '/home';
  const topbarTitle = isHome
    ? (organization?.name ?? t('organizationFallback'))
    : t(`nav.${activeItem.key}.label`);
  const topbarDescription = isHome
    ? (organization?.website_url ?? t(`nav.${activeItem.key}.description`))
    : t(`nav.${activeItem.key}.description`);

  function logout() {
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }

  return (
    <div className="min-h-screen bg-muted/50 text-foreground md:flex" style={productShellStyle}>
      <aside className="border-border border-b bg-card md:fixed md:inset-y-0 md:left-0 md:w-(--product-sidebar-width) md:border-r md:border-b-0">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center gap-3 px-5">
            <Image src="/android-chrome-192x192.png" alt={t('logoAlt')} width={36} height={36} />
            <div>
              <p className="font-semibold text-sm">Seopotion</p>
            </div>
          </div>

          <nav className="flex flex-col">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex h-10 items-center gap-3 px-3 font-medium text-sm transition-colors',
                    active
                      ? 'bg-muted'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {t(`nav.${item.key}.label`)}
                </Link>
              );
            })}
          </nav>

          <OrganizationSwitcher />
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col md:pl-(--product-sidebar-width)">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-border border-b bg-card/95 px-4 backdrop-blur sm:px-6">
          <div>
            <p className="font-semibold text-foreground text-sm">{topbarTitle}</p>
            <p className="text-muted-foreground text-xs">{topbarDescription}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="size-4" aria-hidden="true" />
              {t('logout')}
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
