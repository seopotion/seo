import { setRequestLocale } from 'next-intl/server';
import { routeLocale } from '@/i18n/locale';
import { ProductPlaceholderPage } from '../_components/ProductPlaceholderPage';

export default async function BacklinksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(routeLocale(locale));

  return <ProductPlaceholderPage />;
}
