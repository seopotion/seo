/**
 * Competitor entries are the highest-leverage input onboarding collects: the
 * strategy pipeline's `ranked_keywords` branch looks up what each competitor
 * already ranks for. Each value is handed to DataForSEO as a `target`, which
 * runs it through `bareDomain()` (scheme/www/path stripped) — so a full URL
 * works but a company *name* silently becomes a garbage lookup. We canonicalize
 * to that same bare domain here so what the user sees is what the provider gets.
 */

/** More than a handful multiplies provider calls — one request per competitor. */
export const MAX_COMPETITORS = 5;

/** A hostname label: alphanumeric, inner hyphens allowed. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const TLD = /^[a-z]{2,}$/;

export type CompetitorRejection = 'empty' | 'not_a_domain' | 'duplicate' | 'max';

export type CompetitorNormalization =
  | { ok: true; domain: string }
  | { ok: false; reason: 'empty' | 'not_a_domain' };

export type CompetitorEntryResult =
  | { ok: true; domain: string }
  | { ok: false; reason: CompetitorRejection };

/** `Onboarding.validation` key for a rejection, so both surfaces say the same thing. */
export function competitorErrorKey(reason: CompetitorRejection) {
  if (reason === 'duplicate') return 'competitorsDuplicate';
  if (reason === 'max') return 'competitorsMax';
  return 'competitorDomain';
}

/**
 * `" HTTPS://WWW.Competitor.com/pricing?x=1 "` → `competitor.com`. Anything that
 * is not a resolvable-looking domain — a company name, a bare word, an IP — is
 * rejected rather than passed through.
 */
export function normalizeCompetitorDomain(value: string): CompetitorNormalization {
  const trimmed = value.trim();

  if (!trimmed) return { ok: false, reason: 'empty' };

  let hostname: string;

  try {
    // The URL parser handles the path/port/userinfo stripping and IDN punycode.
    hostname = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return { ok: false, reason: 'not_a_domain' };
  }

  const domain = hostname.toLowerCase().replace(/^www\./, '');
  const labels = domain.split('.');

  if (domain.length > 253) return { ok: false, reason: 'not_a_domain' };
  if (labels.length < 2) return { ok: false, reason: 'not_a_domain' };
  if (labels.some((label) => label.length > 63 || !LABEL.test(label))) {
    return { ok: false, reason: 'not_a_domain' };
  }
  // An all-digit last label means an IP address, which is never a useful target.
  if (!TLD.test(labels.at(-1) as string)) return { ok: false, reason: 'not_a_domain' };

  return { ok: true, domain };
}

/** Normalize one typed entry against the list it would join. */
export function prepareCompetitor(value: string, existing: string[]): CompetitorEntryResult {
  const normalized = normalizeCompetitorDomain(value);

  if (!normalized.ok) return normalized;
  if (existing.includes(normalized.domain)) return { ok: false, reason: 'duplicate' };
  if (existing.length >= MAX_COMPETITORS) return { ok: false, reason: 'max' };

  return normalized;
}

/**
 * Normalize a stored `presets.audience.competitors` array for display. Values
 * that cannot be a domain are dropped: they were never a usable provider target.
 */
export function normalizeCompetitorList(values: string[]): string[] {
  const domains: string[] = [];

  for (const value of values) {
    const normalized = normalizeCompetitorDomain(value);
    if (normalized.ok && !domains.includes(normalized.domain)) domains.push(normalized.domain);
  }

  return domains;
}
