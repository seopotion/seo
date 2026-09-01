import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function NavbarLogo() {
  const t = useTranslations('Navbar');

  return (
    <Link
      className="inline-flex items-center gap-2 justify-self-start no-underline"
      href="/"
      aria-label={t('homeLabel')}
    >
      <Image src="/android-chrome-192x192.png" alt={t('logoAlt')} width={32} height={32} />
      <span className="text-lg font-bold text-foreground sm:text-2xl">Seopotion</span>
    </Link>
  );
}
