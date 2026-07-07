import { reject } from './filters';
import type { WorkingCandidate } from './types';

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'to',
  'and',
  'or',
  'in',
  'on',
  'with',
  'your',
  'you',
  'is',
  'are',
]);

function tokens(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter((w) => w && !STOPWORDS.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Greedy clustering; highest-volume keyword per cluster survives (deterministic order). */
export function clusterCandidates(
  candidates: WorkingCandidate[],
  jaccardThreshold: number,
): { survivors: WorkingCandidate[]; rejected: WorkingCandidate[] } {
  const ordered = [...candidates].sort(
    (a, b) =>
      (b.search_volume ?? -1) - (a.search_volume ?? -1) || a.normalized.localeCompare(b.normalized),
  );

  const heads: { candidate: WorkingCandidate; tokens: Set<string> }[] = [];
  const survivors: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];

  for (const c of ordered) {
    const tk = tokens(c.normalized);
    const head = heads.find((h) => jaccard(h.tokens, tk) >= jaccardThreshold);
    if (head) rejected.push(reject(c, 'clustered_duplicate'));
    else {
      heads.push({ candidate: c, tokens: tk });
      survivors.push(c);
    }
  }
  return { survivors, rejected };
}
