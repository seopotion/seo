import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SITE_NAME, SITE_URL } from '../lib/seo';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  icons: {
    icon: '/favicon.ico',
    apple: '/android-chrome-192x192.png',
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
