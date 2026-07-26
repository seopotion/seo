import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Navbar } from '@/components/navbar';

export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
