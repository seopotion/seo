import type { ReactNode } from 'react';
import { Navbar } from '../components/navbar';
import './globals.css';

export const metadata = {
  title: 'Rankpace',
  description: 'All in one SEO solution, increasing google search ranking and making your brand mentioned by chatgpt and other llms',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
