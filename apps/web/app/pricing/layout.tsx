import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const title = 'Pricing';
const description =
  'Compare Seopotion plans for automated AI SEO content, CMS publishing, keyword research, and expert-led SEO growth.';

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: '/pricing',
  },
  openGraph: {
    title: `${title} | Seopotion`,
    description,
    url: '/pricing',
  },
  twitter: {
    title: `${title} | Seopotion`,
    description,
  },
};

export default function PricingLayout({ children }: { children: ReactNode }) {
  return children;
}
