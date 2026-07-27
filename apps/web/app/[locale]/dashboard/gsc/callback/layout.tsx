import type { ReactNode } from 'react';

/**
 * The callback page exists only to read `?code&state` off the request. Now that
 * the app is statically renderable, prerendering it would bake the empty
 * Suspense fallback that `useSearchParams` requires and push the real render to
 * the client — a blank flash on the OAuth return. Opt the segment out so the
 * shell is server-rendered, as it was before.
 *
 * The config lives here rather than in `page.tsx` because route segment config
 * is only read from server components, and that page is `'use client'`.
 */
export const dynamic = 'force-dynamic';

export default function GscCallbackLayout({ children }: { children: ReactNode }) {
  return children;
}
