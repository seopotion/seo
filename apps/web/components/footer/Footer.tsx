import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { NavbarLogo } from '../navbar/NavbarLogo';

const linkClassName = 'transition-colors hover:text-gray-900';

export function Footer() {
  const t = useTranslations('Footer');

  return (
    <footer className="border-gray-100 border-t px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <NavbarLogo />
          <nav
            aria-label={t('navigationLabel')}
            className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-gray-600"
          >
            <Link href="/#features" className={linkClassName}>
              {t('features')}
            </Link>
            <Link href="/pricing" className={linkClassName}>
              {t('pricing')}
            </Link>
            <Link href="/blog" className={linkClassName}>
              {t('blog')}
            </Link>
          </nav>
          <p className="text-gray-500 text-sm">{t('copyright')}</p>
        </div>

        <nav
          aria-label={t('legalNavigationLabel')}
          className="mt-8 flex flex-wrap items-center justify-center gap-2 border-gray-100 border-t pt-6 text-gray-500 text-sm"
        >
          <Link href="/terms" className={linkClassName}>
            {t('termsOfService')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className={linkClassName}>
            {t('privacyPolicy')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/refunds" className={linkClassName}>
            {t('refundPolicy')}
          </Link>
          <span aria-hidden="true">·</span>
          <a href="mailto:support@seopotion.co" className={linkClassName}>
            {t('supportEmail')}
          </a>
        </nav>
      </div>
    </footer>
  );
}
