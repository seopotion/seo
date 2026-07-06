'use client';

import {
  Archive,
  BarChart3,
  FileSliders,
  Home,
  LayoutList,
  Link2,
  LogOut,
  Megaphone,
  Settings,
  Sparkles,
} from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher';
import { Button } from '@/components/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

type ProductOrganization = {
  id: string;
  name?: string;
  website_url: string;
};

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
  {
    href: '/backlinks',
    key: 'backlinks',
    icon: Link2,
  },
  {
    href: '/ads',
    key: 'ads',
    icon: Megaphone,
  },
  {
    href: '/analytics',
    key: 'analytics',
    icon: BarChart3,
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
  const [organization, setOrganization] = useState<ProductOrganization | null>(null);
  const [organizationLoaded, setOrganizationLoaded] = useState(false);
  const activeItem = navItems.find((item) => item.href === pathname) ?? navItems[0];
  const isHome = pathname === '/home';
  const topbarTitle = isHome
    ? (organization?.name ?? t('organizationFallback'))
    : t(`nav.${activeItem.key}.label`);
  const topbarDescription = isHome
    ? (organization?.website_url ?? t(`nav.${activeItem.key}.description`))
    : t(`nav.${activeItem.key}.description`);

  useEffect(() => {
    if (!isHome || organizationLoaded) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const orgsRes = await api.api.v0.core.organizations.$get();

        if (orgsRes.ok) {
          const { organizations } = await orgsRes.json();

          if (!cancelled) {
            setOrganization(organizations[0] ?? null);
          }
        }
      } catch {
        if (!cancelled) {
          setOrganization(null);
        }
      } finally {
        if (!cancelled) {
          setOrganizationLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHome, organizationLoaded]);

  function logout() {
    clearToken();
    router.replace('/');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 md:flex" style={productShellStyle}>
      <aside className="border-slate-200 border-b bg-white md:fixed md:inset-y-0 md:left-0 md:w-(--product-sidebar-width) md:border-r md:border-b-0">
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
              const active = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex h-10 items-center gap-3 px-3 font-medium text-sm transition-colors',
                    active
                      ? 'bg-slate-200'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {t(`nav.${item.key}.label`)}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col md:pl-(--product-sidebar-width)">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-slate-200 border-b bg-white/95 px-4 backdrop-blur sm:px-6">
          <div>
            <p className="font-semibold text-slate-950 text-sm">{topbarTitle}</p>
            <p className="text-slate-500 text-xs">{topbarDescription}</p>
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
