import type { RejectionReason } from '@shared/schemas';
import type { WorkingCandidate } from './types';

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
