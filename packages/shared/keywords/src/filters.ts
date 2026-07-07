import type { DataForSeoClient } from '@shared/providers';
import type { RejectionReason } from '@shared/schemas';
import type { ResolvedConfig, WorkingCandidate } from './types';

export function reject(c: WorkingCandidate, reason: RejectionReason): WorkingCandidate {
  return { ...c, status: 'rejected', rejection_reason: reason };
}

const NAV_PHRASES = [
  'login',
  'log in',
  'sign in',
  'sign up',
  'contact us',
  'contact',
  'careers',
  'pricing',
  'download',
  'checkout',
  'cart',
  'faq',
  'terms of service',
  'privacy policy',
];

/** Registrable-ish domain label, e.g. https://sub.acme.io/x -> "acme". */
function domainLabel(websiteUrl: string): string {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    return (parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!).toLowerCase();
  } catch {
    return '';
  }
}

/** Whitespace-delimited token subsequence match, so "pricing" != "pricingx". */
function containsPhrase(normalized: string, phrase: string): boolean {
  const t = normalized.split(' ');
  const p = phrase.split(' ');
  for (let i = 0; i + p.length <= t.length; i++) {
    if (p.every((w, j) => t[i + j] === w)) return true;
  }
  return false;
}

export function brandNavFilter(
  candidates: WorkingCandidate[],
  opts: { orgName: string; websiteUrl: string },
): { survivors: WorkingCandidate[]; rejected: WorkingCandidate[] } {
  const brand = new Set(
    opts.orgName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
  const label = domainLabel(opts.websiteUrl);
  if (label) brand.add(label);

  const survivors: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];
  for (const c of candidates) {
    const tokens = c.normalized.split(' ');
    const hitsBrand = tokens.some((t) => brand.has(t));
    const hitsNav = NAV_PHRASES.some((p) => containsPhrase(c.normalized, p));
    if (hitsBrand || hitsNav) rejected.push(reject(c, 'brand_navigation'));
    else survivors.push(c);
  }
  return { survivors, rejected };
}

/** Fill null difficulty via one batched bulk lookup; present values are untouched. */
export async function fillDifficulty(
  candidates: WorkingCandidate[],
  deps: { dataForSeo: DataForSeoClient; config: ResolvedConfig },
): Promise<WorkingCandidate[]> {
  const missing = candidates.filter((c) => c.difficulty === null);
  if (missing.length === 0) return candidates;

  const metrics = await deps.dataForSeo.bulkKeywordDifficulty({
    keywords: missing.map((c) => c.keyword),
    locationName: deps.config.locationName,
    languageName: deps.config.languageName,
  });
  const byKeyword = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m.difficulty]));

  return candidates.map((c) =>
    c.difficulty === null
      ? { ...c, difficulty: byKeyword.get(c.keyword.toLowerCase()) ?? null }
      : c,
  );
}

export function applyDifficultyCeiling(
  candidates: WorkingCandidate[],
  ceiling: number,
): { survivors: WorkingCandidate[]; rejected: WorkingCandidate[] } {
  const survivors: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];
  for (const c of candidates) {
    if (c.difficulty !== null && c.difficulty > ceiling)
      rejected.push(reject(c, 'difficulty_ceiling'));
    else survivors.push(c);
  }
  return { survivors, rejected };
}
