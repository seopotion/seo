/**
 * GSC pure helpers + shared types (#12). Kept free of the api/react-query/DOM
 * graph so the unit test can import them without dragging browser-only modules
 * into the root (backend) typecheck, which compiles `apps/web/tests/**`.
 */

/** sessionStorage key: the Settings panel stores the user's locale before the
 * full-page redirect to Google so the callback can restore it on the way back
 * (Google always redirects to the unprefixed `en` callback URL). */
export const GSC_RETURN_LOCALE_KEY = 'seo_gsc_return_locale';

export type GscStatus = {
  connected: boolean;
  google_email: string | null;
  site_url: string | null;
  connected_at: string | null;
  needs_reconnect: boolean;
};

export type GscSite = { site_url: string; permission_level: string };

/** Best-guess GSC property for the org's website: sc-domain match wins, then URL-prefix host match. */
export function matchGscProperty(websiteUrl: string, sites: GscSite[]): string | null {
  let hostname: string;
  try {
    hostname = new URL(websiteUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const domainMatch = sites.find((site) => {
    if (!site.site_url.startsWith('sc-domain:')) return false;
    const domain = site.site_url.slice('sc-domain:'.length);
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
  if (domainMatch) return domainMatch.site_url;
  const urlMatch = sites.find((site) => {
    if (site.site_url.startsWith('sc-domain:')) return false;
    try {
      return new URL(site.site_url).hostname.replace(/^www\./, '') === hostname;
    } catch {
      return false;
    }
  });
  return urlMatch ? urlMatch.site_url : null;
}
