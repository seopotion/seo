import type { ReactNode } from 'react';

/**
 * Same reasoning as the GSC callback's layout: the page exists to read query
 * params, so prerendering it would bake the empty `useSearchParams` Suspense
 * fallback and flash a blank screen on the way back from github.com.
 */
export const dynamic = 'force-dynamic';

export default function GithubCallbackLayout({ children }: { children: ReactNode }) {
  return children;
}
