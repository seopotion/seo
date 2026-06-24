import type { ReactNode } from 'react';

export const metadata = {
  title: 'SEO Dev',
  description: 'SEO Dev onboarding',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
