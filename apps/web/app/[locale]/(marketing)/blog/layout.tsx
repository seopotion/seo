import type { ReactNode } from 'react';

/**
 * Blog chrome. Unlike `/docs` there is no sidebar — the index is a single
 * column and the post page grows its own table-of-contents rail at `lg`, so the
 * shared shell is just the page container.
 */
export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-6 py-12 lg:py-16">{children}</div>
    </main>
  );
}
