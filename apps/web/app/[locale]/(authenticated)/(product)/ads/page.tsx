import { setRequestLocale } from 'next-intl/server';
import { ProductPlaceholderPage } from '../_components/ProductPlaceholderPage';

export default async function AdsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ProductPlaceholderPage />;
}
