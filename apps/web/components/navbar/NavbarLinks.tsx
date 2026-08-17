import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

const NAV_LINKS = [
  { href: '/#features', key: 'features' },
  { href: '/pricing', key: 'pricing' },
  { href: '/docs', key: 'docs' },
  { href: '/blog', key: 'blog' },
] as const;

const linkClassName =
  'rounded-md px-3 py-2 text-sm font-semibold leading-none text-muted-foreground no-underline transition-colors hover:text-black focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none';

export function NavbarLinks() {
  const t = useTranslations('Navbar');

  return (
    <nav
      className="order-3 col-span-2 hidden sm:flex items-center justify-start gap-1 overflow-x-auto sm:order-0 sm:col-span-1 sm:justify-center"
      aria-label={t('primaryNavigation')}
    >
      {NAV_LINKS.map((link) => (
        <Link className={linkClassName} href={link.href} key={link.href}>
          {t(`links.${link.key}`)}
        </Link>
      ))}
    </nav>
  );
}
