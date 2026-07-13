# Keyword Opportunity Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@shared/keywords`, a pure pipeline that turns DataForSEO results into ranked, SERP-validated, article-typed content opportunities (#54).

**Architecture:** One exported function `runKeywordPipeline(input)` in a new shared package. All I/O (DataForSEO + LLM) is injected; it reads no DB and returns enriched candidate records the caller persists. Twelve deterministic stages: gather → dedupe → brand/nav filter → cluster → fill-difficulty → KD≤45 ceiling → relevance → score → rank/top-N → SERP-validate → classify → assemble.

**Tech Stack:** TypeScript 6 (bundler resolution, `verbatimModuleSyntax`), Zod 4, Vitest 4, npm workspaces. No new dependencies.

## Global Constraints

- Package name `@shared/keywords`; `exports: { ".": "./src/index.ts" }`; internal deps use `"*"`. TS source only, no build step (esbuild bundles it into consumers).
- `import type` for type-only imports; `export type` when re-exporting types (verbatimModuleSyntax).
- Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` before each commit.
- **Determinism is a hard requirement:** no `Date.now`, `Math.random`, or reliance on `Set`/`Map` insertion order for output ordering. Every sort has an explicit tiebreak on `normalized`. LLM calls pass `temperature: 0` and `responseFormat: 'json'`; parsers apply documented defaults so a fixed response yields a fixed result.
- The pipeline never persists; it returns `EnrichedCandidate[]`. `normalized_keyword` and timestamps are assigned later by `CandidateRepo`.
- Tests are unit-only under `packages/shared/keywords/tests/*.test.ts` (picked up by root `vitest.config.ts`); no infra. Use in-memory fake clients, never real `fetch`.
- Verification gates before "done": `npm run lint`, `npm run check:all`, `npm test`.
- Difficulty ceiling is **45** (issue-mandated). Article-type and rejection-reason are constrained enums.

---

### Task 1: Candidate schema — article_type, rejection_reason, exported enums/types

**Files:**
- Modify: `packages/shared/schemas/src/candidate.ts`
- Test: `packages/shared/schemas/tests/candidate.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `ARTICLE_TYPES` (readonly tuple), `ArticleType` type
  - `REJECTION_REASONS` (readonly tuple), `RejectionReason` type
  - `CandidateSource` type (from existing `CANDIDATE_SOURCES`)
  - `CandidateStatus` type (from existing `CANDIDATE_STATUSES`)
  - `CandidateSchema` gains `article_type: ArticleType | null` and `rejection_reason: RejectionReason | null`, both defaulting to `null`.

- [ ] **Step 1: Write the failing test** — append to `packages/shared/schemas/tests/candidate.test.ts`:

```ts
import { ARTICLE_TYPES, CandidateSchema, REJECTION_REASONS } from '@shared/schemas';

describe('candidate #54 fields', () => {
  const base = {
    id: 'c1',
    org_id: 'o1',
    keyword: 'best dog food',
    normalized_keyword: 'best dog food',
    source: 'keyword_ideas' as const,
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('defaults article_type and rejection_reason to null', () => {
    const c = CandidateSchema.parse(base);
    expect(c.article_type).toBeNull();
    expect(c.rejection_reason).toBeNull();
  });

  it('accepts a valid article_type and rejection_reason', () => {
    const c = CandidateSchema.parse({
      ...base,
      article_type: 'how_to_guide',
      rejection_reason: 'serp_authority',
    });
    expect(c.article_type).toBe('how_to_guide');
    expect(c.rejection_reason).toBe('serp_authority');
  });

  it('rejects an unknown article_type', () => {
    expect(() => CandidateSchema.parse({ ...base, article_type: 'tweet' })).toThrow();
  });

  it('exposes the constrained enums', () => {
    expect(ARTICLE_TYPES).toContain('case_study');
    expect(ARTICLE_TYPES).toContain('other');
    expect(REJECTION_REASONS).toContain('difficulty_ceiling');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- candidate`
Expected: FAIL — `ARTICLE_TYPES`/`REJECTION_REASONS` are not exported; the new fields don't exist.

- [ ] **Step 3: Implement** — in `packages/shared/schemas/src/candidate.ts`, add the enums and types, and extend the schema.

Add type exports beside the existing tuples (near the top):

```ts
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** Constrained article types a classified candidate can become (#54). */
export const ARTICLE_TYPES = [
  'how_to_guide',
  'listicle',
  'comparison',
  'definition',
  'product_guide',
  'case_study',
  'other',
] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

/** Why a candidate was rejected by the pipeline (#54). */
export const REJECTION_REASONS = [
  'brand_navigation',
  'clustered_duplicate',
  'difficulty_ceiling',
  'serp_intent',
  'serp_authority',
  'serp_locality',
  'serp_duplicate',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
```

Add these two fields inside `CandidateSchema`, right after `opportunity_score`:

```ts
  article_type: z.enum(ARTICLE_TYPES).nullable().default(null),
  rejection_reason: z.enum(REJECTION_REASONS).nullable().default(null),
```

Update the docstring line above `relevance_score`/`opportunity_score` note if desired (optional). Leave `CreateCandidateInput`'s omit list unchanged — the two new fields stay in the create input, defaulting to null.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- candidate && npm run check`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/schemas
git commit -m "$(printf '[dashboard] Add article_type + rejection_reason to candidate schema\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Package scaffold — types, config, index

**Files:**
- Create: `packages/shared/keywords/package.json`
- Create: `packages/shared/keywords/src/types.ts`
- Create: `packages/shared/keywords/src/config.ts`
- Create: `packages/shared/keywords/src/index.ts`
- Test: `packages/shared/keywords/tests/config.test.ts`

**Interfaces:**
- Consumes: `ArticleType`, `RejectionReason`, `CandidateSource`, `CandidateStatus`, `SearchIntent`, `SetupPresets` from `@shared/schemas`; `DataForSeoClient`, `LlmClient` from `@shared/providers`.
- Produces:
  - `WorkingCandidate` (internal mutable record threaded through stages)
  - `EnrichedCandidate` (output record; assignable to `CreateCandidateInput`)
  - `PipelineInput`, `PipelineConfig`, `ResolvedConfig`, `PipelineResult`
  - `DEFAULT_CONFIG: Omit<ResolvedConfig, 'locationName' | 'languageName'>`
  - `resolveConfig(presets: SetupPresets, partial?: Partial<PipelineConfig>): ResolvedConfig`

- [ ] **Step 1: Create the package manifest** — `packages/shared/keywords/package.json`:

```json
{
  "name": "@shared/keywords",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@shared/providers": "*",
    "@shared/schemas": "*"
  }
}
```

Then wire the workspace so `@shared/keywords` resolves:

```bash
npm install
```

- [ ] **Step 2: Create `src/types.ts`**:

```ts
import type { DataForSeoClient, LlmClient } from '@shared/providers';
import type {
  ArticleType,
  CandidateSource,
  CandidateStatus,
  RejectionReason,
  SearchIntent,
  SetupPresets,
} from '@shared/schemas';

/** A candidate as it flows through the pipeline. `normalized` is the dedup key. */
export interface WorkingCandidate {
  keyword: string;
  normalized: string;
  source: CandidateSource;
  source_context: string | null;
  search_volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number | null;
  intent: SearchIntent | null;
  relevance_score: number | null;
  opportunity_score: number | null;
  article_type: ArticleType | null;
  rejection_reason: RejectionReason | null;
  status: CandidateStatus;
}

/** Pipeline output — assignable to `CreateCandidateInput` (repo derives normalized_keyword). */
export interface EnrichedCandidate {
  org_id: string;
  keyword: string;
  source: CandidateSource;
  source_context: string | null;
  search_volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number | null;
  intent: SearchIntent | null;
  relevance_score: number | null;
  opportunity_score: number | null;
  article_type: ArticleType | null;
  rejection_reason: RejectionReason | null;
  status: CandidateStatus;
}

export interface ScoreWeights {
  relevance: number;
  volume: number;
  ease: number;
  trend: number;
  cannibalization: number;
}

export interface PipelineConfig {
  difficultyCeiling: number;
  serpTopN: number;
  serpDepth: number;
  serpTopK: number;
  volumeCap: number;
  clusterJaccard: number;
  authorityDomains: string[];
  authorityThreshold: number;
  duplicateSerpOverlap: number;
  weights: ScoreWeights;
  locationName?: string;
  languageName?: string;
  endpointLimits: {
    keywordsForSite: number;
    rankedKeywords: number;
    keywordIdeas: number;
  };
}

/** Config after defaults + preset-derived location/language are applied. */
export type ResolvedConfig = Required<Omit<PipelineConfig, 'locationName' | 'languageName'>> & {
  locationName?: string;
  languageName?: string;
};

export interface PipelineInput {
  orgId: string;
  websiteUrl: string;
  presets: SetupPresets;
  competitors: string[];
  existingKeywords: string[];
  existingArticleKeywords: string[];
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
  config?: Partial<PipelineConfig>;
}

export interface PipelineStats {
  gathered: number;
  afterDedupe: number;
  afterBrandNav: number;
  clustered: number;
  afterCeiling: number;
  scored: number;
  serpValidated: number;
  accepted: number;
  rejectedByReason: Record<RejectionReason, number>;
}

export interface PipelineResult {
  candidates: EnrichedCandidate[];
  stats: PipelineStats;
}
```

- [ ] **Step 3: Create `src/config.ts`**:

```ts
import type { SetupPresets } from '@shared/schemas';
import type { PipelineConfig, ResolvedConfig } from './types';

/** Defaults for everything except location/language, which come from presets. */
export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'locationName' | 'languageName'> = {
  difficultyCeiling: 45,
  serpTopN: 20,
  serpDepth: 20,
  serpTopK: 10,
  volumeCap: 10_000,
  clusterJaccard: 0.6,
  authorityDomains: [
    'wikipedia.org',
    'amazon.com',
    'reddit.com',
    'youtube.com',
    'quora.com',
    'linkedin.com',
    'pinterest.com',
  ],
  authorityThreshold: 0.5,
  duplicateSerpOverlap: 0.6,
  weights: { relevance: 0.35, volume: 0.3, ease: 0.2, trend: 0.1, cannibalization: 0.05 },
  endpointLimits: { keywordsForSite: 200, rankedKeywords: 200, keywordIdeas: 200 },
};

/** Merge defaults + caller overrides, deriving location/language from presets when absent. */
export function resolveConfig(
  presets: SetupPresets,
  partial: Partial<PipelineConfig> = {},
): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    weights: { ...DEFAULT_CONFIG.weights, ...partial.weights },
    endpointLimits: { ...DEFAULT_CONFIG.endpointLimits, ...partial.endpointLimits },
    authorityDomains: partial.authorityDomains ?? DEFAULT_CONFIG.authorityDomains,
    locationName: partial.locationName ?? presets.business.country,
    languageName: partial.languageName ?? presets.business.language,
  };
}
```

- [ ] **Step 4: Create `src/index.ts`** (pipeline export added in Task 12):

```ts
export type * from './types';
export { DEFAULT_CONFIG, resolveConfig } from './config';
```

- [ ] **Step 5: Write the test** — `packages/shared/keywords/tests/config.test.ts`:

```ts
import { DEFAULT_CONFIG, resolveConfig } from '@shared/keywords';
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it } from 'vitest';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'x' },
  audience: { target: 't', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
  },
} satisfies SetupPresets;

describe('resolveConfig', () => {
  it('derives location/language from presets by default', () => {
    const c = resolveConfig(presets);
    expect(c.locationName).toBe('United States');
    expect(c.languageName).toBe('English');
    expect(c.difficultyCeiling).toBe(45);
  });

  it('caller overrides win and merge deeply', () => {
    const c = resolveConfig(presets, { serpTopN: 5, weights: { volume: 0.9 } as never });
    expect(c.serpTopN).toBe(5);
    expect(c.weights.volume).toBe(0.9);
    expect(c.weights.relevance).toBe(DEFAULT_CONFIG.weights.relevance);
  });
});
```

- [ ] **Step 6: Run and verify**

Run: `npm test -- config && npm run check`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords package.json package-lock.json
git commit -m "$(printf '[dashboard] Scaffold @shared/keywords package (types + config)\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Normalize + dedupe

**Files:**
- Create: `packages/shared/keywords/src/normalize.ts`
- Test: `packages/shared/keywords/tests/normalize.test.ts`

**Interfaces:**
- Consumes: `WorkingCandidate` (Task 2); `KeywordMetric`, `CandidateSource` from providers/schemas; `normalizeKeyword` from `@shared/schemas`.
- Produces:
  - `toWorking(metric: KeywordMetric, source: CandidateSource, context: string | null): WorkingCandidate`
  - `dedupe(candidates: WorkingCandidate[]): WorkingCandidate[]` — one per `normalized`, keeping the record with the most non-null metrics (tiebreak: keep first in input order).

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/normalize.test.ts`:

```ts
import type { KeywordMetric } from '@shared/providers';
import { describe, expect, it } from 'vitest';
import { dedupe, toWorking } from '../src/normalize';

const metric = (over: Partial<KeywordMetric>): KeywordMetric => ({
  keyword: 'Best Dog  Food',
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  ...over,
});

describe('toWorking', () => {
  it('normalizes the keyword and carries provenance', () => {
    const w = toWorking(metric({ keyword: 'Best Dog  Food' }), 'keyword_ideas', 'seed');
    expect(w.normalized).toBe('best dog food');
    expect(w.source).toBe('keyword_ideas');
    expect(w.source_context).toBe('seed');
    expect(w.status).toBe('candidate');
  });
});

describe('dedupe', () => {
  it('collapses same normalized keyword, keeping the richer record', () => {
    const bare = toWorking(metric({ keyword: 'dog food' }), 'keyword_ideas', null);
    const rich = toWorking(
      metric({ keyword: 'Dog Food', search_volume: 100, difficulty: 10 }),
      'ranked_keywords',
      'comp.com',
    );
    const out = dedupe([bare, rich]);
    expect(out).toHaveLength(1);
    expect(out[0]!.search_volume).toBe(100);
    expect(out[0]!.source).toBe('ranked_keywords');
  });

  it('keeps distinct keywords', () => {
    const a = toWorking(metric({ keyword: 'a' }), 'keyword_ideas', null);
    const b = toWorking(metric({ keyword: 'b' }), 'keyword_ideas', null);
    expect(dedupe([a, b])).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- normalize`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/normalize.ts`**:

```ts
import type { KeywordMetric } from '@shared/providers';
import { type CandidateSource, normalizeKeyword } from '@shared/schemas';
import type { WorkingCandidate } from './types';

export function toWorking(
  metric: KeywordMetric,
  source: CandidateSource,
  context: string | null,
): WorkingCandidate {
  return {
    keyword: metric.keyword,
    normalized: normalizeKeyword(metric.keyword),
    source,
    source_context: context,
    search_volume: metric.search_volume,
    difficulty: metric.difficulty,
    cpc: metric.cpc,
    competition: metric.competition,
    trend: metric.trend,
    intent: metric.intent,
    relevance_score: null,
    opportunity_score: null,
    article_type: null,
    rejection_reason: null,
    status: 'candidate',
  };
}

function richness(c: WorkingCandidate): number {
  const fields = [c.search_volume, c.difficulty, c.cpc, c.competition, c.trend, c.intent];
  return fields.filter((v) => v !== null).length;
}

/** One record per normalized keyword; the richest wins, ties keep first seen. */
export function dedupe(candidates: WorkingCandidate[]): WorkingCandidate[] {
  const best = new Map<string, WorkingCandidate>();
  for (const c of candidates) {
    const existing = best.get(c.normalized);
    if (!existing || richness(c) > richness(existing)) best.set(c.normalized, c);
  }
  return [...best.values()];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- normalize`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add keyword normalize + dedupe stage\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Brand/navigation filter

**Files:**
- Create: `packages/shared/keywords/src/filters.ts`
- Test: `packages/shared/keywords/tests/filters.test.ts`

**Interfaces:**
- Consumes: `WorkingCandidate`.
- Produces:
  - `reject(c: WorkingCandidate, reason: RejectionReason): WorkingCandidate` (shared helper — status `rejected` + reason).
  - `brandNavFilter(candidates, opts): { survivors: WorkingCandidate[]; rejected: WorkingCandidate[] }` where `opts = { orgName: string; websiteUrl: string }`. Rejects keywords containing a brand token (org-name word ≥3 chars, or the registrable domain label) or a navigation phrase → `brand_navigation`.

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { brandNavFilter } from '../src/filters';
import type { WorkingCandidate } from '../src/types';

const cand = (keyword: string): WorkingCandidate => ({
  keyword,
  normalized: keyword.toLowerCase(),
  source: 'keyword_ideas',
  source_context: null,
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: null,
  opportunity_score: null,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
});

describe('brandNavFilter', () => {
  const opts = { orgName: 'Acme Robotics', websiteUrl: 'https://acmerobotics.io' };

  it('rejects brand-name and domain-label matches', () => {
    const { survivors, rejected } = brandNavFilter(
      [cand('acme robotics reviews'), cand('acmerobotics login'), cand('robot vacuum guide')],
      opts,
    );
    expect(survivors.map((c) => c.keyword)).toEqual(['robot vacuum guide']);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.rejection_reason).toBe('brand_navigation');
    expect(rejected[0]!.status).toBe('rejected');
  });

  it('rejects navigation phrases', () => {
    const { survivors } = brandNavFilter([cand('best robot pricing'), cand('sign in page')], opts);
    expect(survivors).toHaveLength(0);
  });

  it('keeps unrelated keywords', () => {
    const { survivors } = brandNavFilter([cand('how to clean floors')], opts);
    expect(survivors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- filters`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/filters.ts`** (brand/nav portion; ceiling + fill added in Tasks 5–6):

```ts
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
    const hitsBrand = tokens.some((t) => brand.has(t)) || (label && c.normalized.includes(label));
    const hitsNav = NAV_PHRASES.some((p) => containsPhrase(c.normalized, p));
    if (hitsBrand || hitsNav) rejected.push(reject(c, 'brand_navigation'));
    else survivors.push(c);
  }
  return { survivors, rejected };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- filters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add brand/navigation keyword filter\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Fill difficulty (batched) + difficulty ceiling

**Files:**
- Modify: `packages/shared/keywords/src/filters.ts`
- Test: `packages/shared/keywords/tests/filters.test.ts` (append)

**Interfaces:**
- Consumes: `reject` (Task 4); `DataForSeoClient` from providers; `ResolvedConfig`.
- Produces:
  - `fillDifficulty(candidates, deps): Promise<WorkingCandidate[]>` — `deps = { dataForSeo: DataForSeoClient; config: ResolvedConfig }`. Calls `bulkKeywordDifficulty` **only** with keywords whose `difficulty` is null; leaves present values untouched; if none are missing, the provider is not called.
  - `applyDifficultyCeiling(candidates, ceiling): { survivors; rejected }` — `difficulty > ceiling` → `difficulty_ceiling`; null difficulty is kept.

- [ ] **Step 1: Write the failing test** — append to `filters.test.ts`:

```ts
import type { DataForSeoClient } from '@shared/providers';
import { vi } from 'vitest';
import { applyDifficultyCeiling, fillDifficulty } from '../src/filters';
import { DEFAULT_CONFIG } from '../src/config';

const withDiff = (keyword: string, difficulty: number | null): WorkingCandidate => ({
  ...cand(keyword),
  difficulty,
});

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };

describe('fillDifficulty', () => {
  it('queries only the missing-difficulty subset and merges results', async () => {
    const bulk = vi
      .fn()
      .mockResolvedValue([{ keyword: 'a', difficulty: 30, search_volume: null, cpc: null, competition: null, trend: null, intent: null }]);
    const dataForSeo = { bulkKeywordDifficulty: bulk } as unknown as DataForSeoClient;

    const out = await fillDifficulty([withDiff('a', null), withDiff('b', 20)], { dataForSeo, config });

    expect(bulk).toHaveBeenCalledTimes(1);
    expect(bulk.mock.calls[0]![0].keywords).toEqual(['a']);
    expect(out.find((c) => c.keyword === 'a')!.difficulty).toBe(30);
    expect(out.find((c) => c.keyword === 'b')!.difficulty).toBe(20);
  });

  it('does not call the provider when nothing is missing', async () => {
    const bulk = vi.fn();
    const dataForSeo = { bulkKeywordDifficulty: bulk } as unknown as DataForSeoClient;
    await fillDifficulty([withDiff('a', 10)], { dataForSeo, config });
    expect(bulk).not.toHaveBeenCalled();
  });
});

describe('applyDifficultyCeiling', () => {
  it('rejects above the ceiling, keeps <=45 and null', () => {
    const { survivors, rejected } = applyDifficultyCeiling(
      [withDiff('keep', 45), withDiff('drop', 46), withDiff('unknown', null)],
      45,
    );
    expect(survivors.map((c) => c.keyword).sort()).toEqual(['keep', 'unknown']);
    expect(rejected[0]!.rejection_reason).toBe('difficulty_ceiling');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- filters`
Expected: FAIL — `fillDifficulty`/`applyDifficultyCeiling` not exported.

- [ ] **Step 3: Implement** — append to `src/filters.ts`:

```ts
import type { DataForSeoClient } from '@shared/providers';
import type { ResolvedConfig } from './types';

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
    if (c.difficulty !== null && c.difficulty > ceiling) rejected.push(reject(c, 'difficulty_ceiling'));
    else survivors.push(c);
  }
  return { survivors, rejected };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- filters && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add batched difficulty fill + KD<=45 ceiling\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Near-duplicate clustering

**Files:**
- Create: `packages/shared/keywords/src/cluster.ts`
- Test: `packages/shared/keywords/tests/cluster.test.ts`

**Interfaces:**
- Consumes: `WorkingCandidate`; `reject` (Task 4).
- Produces: `clusterCandidates(candidates, jaccard): { survivors: WorkingCandidate[]; rejected: WorkingCandidate[] }` — deterministic greedy clustering ordered by `search_volume` desc then `normalized` asc; the head survives, members → `clustered_duplicate`.

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/cluster.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clusterCandidates } from '../src/cluster';
import type { WorkingCandidate } from '../src/types';

const cand = (keyword: string, search_volume: number | null): WorkingCandidate => ({
  keyword,
  normalized: keyword.toLowerCase(),
  source: 'keyword_ideas',
  source_context: null,
  search_volume,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: null,
  opportunity_score: null,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
});

describe('clusterCandidates', () => {
  it('keeps the highest-volume head and rejects near-duplicate members', () => {
    const { survivors, rejected } = clusterCandidates(
      [cand('best running shoes', 100), cand('best running shoe', 500), cand('yoga mat guide', 50)],
      0.6,
    );
    expect(survivors.map((c) => c.keyword).sort()).toEqual(['best running shoe', 'yoga mat guide']);
    expect(rejected[0]!.keyword).toBe('best running shoes');
    expect(rejected[0]!.rejection_reason).toBe('clustered_duplicate');
  });

  it('does not cluster below the Jaccard threshold', () => {
    const { survivors } = clusterCandidates(
      [cand('cheap flights europe', 100), cand('luxury hotels asia', 100)],
      0.6,
    );
    expect(survivors).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cluster`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/cluster.ts`**:

```ts
import type { WorkingCandidate } from './types';
import { reject } from './filters';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'and', 'or', 'in', 'on', 'with', 'your', 'you', 'is', 'are',
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- cluster`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add deterministic near-duplicate clustering\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: LLM prompt builders + tolerant parsers

**Files:**
- Create: `packages/shared/keywords/src/llm-prompts.ts`
- Test: `packages/shared/keywords/tests/llm-prompts.test.ts`

**Interfaces:**
- Consumes: `SetupPresets`, `ArticleType`, `ARTICLE_TYPES` from `@shared/schemas`; `LlmMessage` from providers; `SerpResult` from providers.
- Produces (all pure):
  - `buildSeedPrompt(presets): LlmMessage[]`; `parseSeeds(text): string[]`
  - `buildRelevancePrompt(keywords: string[], presets): LlmMessage[]`; `parseRelevance(text, keywords): Map<string, number>` (default 0, clamped 0–1)
  - `buildSerpJudgmentPrompt(keyword, serp: SerpResult[], presets): LlmMessage[]`; `parseSerpJudgment(text): { intentSuitable: boolean; localitySuitable: boolean; reason: string | null }` (**fail-open**: both `true` on parse failure)
  - `buildClassifyPrompt(keywords: string[], presets): LlmMessage[]`; `parseClassification(text, keywords): Map<string, ArticleType>` (unknown/missing → `'other'`)

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/llm-prompts.test.ts`:

```ts
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildRelevancePrompt,
  parseClassification,
  parseRelevance,
  parseSeeds,
  parseSerpJudgment,
} from '../src/llm-prompts';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'pet food' },
  audience: { target: 'dog owners', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
  },
} satisfies SetupPresets;

describe('parseSeeds', () => {
  it('reads a seeds array', () => {
    expect(parseSeeds('{"seeds":["dog food","puppy diet"]}')).toEqual(['dog food', 'puppy diet']);
  });
  it('returns [] on garbage', () => {
    expect(parseSeeds('not json')).toEqual([]);
  });
});

describe('parseRelevance', () => {
  it('maps and clamps scores, defaulting missing to 0', () => {
    const m = parseRelevance('{"scores":[{"keyword":"dog food","relevance":1.4}]}', ['dog food', 'x']);
    expect(m.get('dog food')).toBe(1);
    expect(m.get('x')).toBe(0);
  });
});

describe('parseSerpJudgment', () => {
  it('parses a decision', () => {
    expect(parseSerpJudgment('{"intentSuitable":false,"localitySuitable":true,"reason":"nav"}')).toEqual({
      intentSuitable: false,
      localitySuitable: true,
      reason: 'nav',
    });
  });
  it('fails open on garbage', () => {
    expect(parseSerpJudgment('oops')).toEqual({
      intentSuitable: true,
      localitySuitable: true,
      reason: null,
    });
  });
});

describe('parseClassification', () => {
  it('validates against the enum and defaults unknowns to other', () => {
    const m = parseClassification(
      '{"types":[{"keyword":"how to bathe a dog","article_type":"how_to_guide"},{"keyword":"x","article_type":"tweet"}]}',
      ['how to bathe a dog', 'x', 'missing'],
    );
    expect(m.get('how to bathe a dog')).toBe('how_to_guide');
    expect(m.get('x')).toBe('other');
    expect(m.get('missing')).toBe('other');
  });
});

describe('buildRelevancePrompt', () => {
  it('includes business context and the keyword list', () => {
    const msgs = buildRelevancePrompt(['dog food'], presets);
    expect(msgs[0]!.role).toBe('system');
    expect(JSON.stringify(msgs)).toContain('dog food');
    expect(JSON.stringify(msgs)).toContain('pet food');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- llm-prompts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/llm-prompts.ts`**:

```ts
import type { LlmMessage, SerpResult } from '@shared/providers';
import { ARTICLE_TYPES, type ArticleType, type SetupPresets } from '@shared/schemas';

const ARTICLE_TYPE_SET = new Set<string>(ARTICLE_TYPES);

function businessContext(presets: SetupPresets): string {
  return [
    `Business: ${presets.business.name}`,
    `Description: ${presets.business.description}`,
    `Target audience: ${presets.audience.target}`,
    `Country: ${presets.business.country}`,
    `Language: ${presets.business.language}`,
  ].join('\n');
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ---- seeds ----
export function buildSeedPrompt(presets: SetupPresets): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'You generate SEO seed keywords. Respond ONLY with JSON: {"seeds": string[]}. ' +
        'Return 10-20 short, generic topic seeds relevant to the business. No brand names.',
    },
    { role: 'user', content: businessContext(presets) },
  ];
}

export function parseSeeds(text: string): string[] {
  const parsed = tryParse(text) as { seeds?: unknown } | null;
  const seeds = parsed?.seeds;
  if (!Array.isArray(seeds)) return [];
  return seeds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

// ---- relevance ----
export function buildRelevancePrompt(keywords: string[], presets: SetupPresets): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'Score each keyword 0..1 for how relevant it is to the business and audience. ' +
        'Respond ONLY with JSON: {"scores":[{"keyword":string,"relevance":number}]}.',
    },
    {
      role: 'user',
      content: `${businessContext(presets)}\n\nKeywords:\n${JSON.stringify(keywords)}`,
    },
  ];
}

export function parseRelevance(text: string, keywords: string[]): Map<string, number> {
  const out = new Map<string, number>(keywords.map((k) => [k, 0]));
  const parsed = tryParse(text) as { scores?: Array<{ keyword?: unknown; relevance?: unknown }> } | null;
  for (const row of parsed?.scores ?? []) {
    if (typeof row.keyword === 'string' && typeof row.relevance === 'number' && out.has(row.keyword)) {
      out.set(row.keyword, clamp01(row.relevance));
    }
  }
  return out;
}

// ---- SERP judgment ----
export function buildSerpJudgmentPrompt(
  keyword: string,
  serp: SerpResult[],
  presets: SetupPresets,
): LlmMessage[] {
  const results = serp.map((r) => `${r.rank}. ${r.title} — ${r.domain}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'Given a keyword and its Google results, decide if a blog article we write could rank. ' +
        'intentSuitable=false if results are product/navigational pages, not informational articles. ' +
        'localitySuitable=false if results are dominated by local businesses/directories for a ' +
        'location that does not match the business country. ' +
        'Respond ONLY with JSON: {"intentSuitable":boolean,"localitySuitable":boolean,"reason":string}.',
    },
    {
      role: 'user',
      content: `${businessContext(presets)}\n\nKeyword: ${keyword}\n\nResults:\n${results}`,
    },
  ];
}

export function parseSerpJudgment(text: string): {
  intentSuitable: boolean;
  localitySuitable: boolean;
  reason: string | null;
} {
  const parsed = tryParse(text) as {
    intentSuitable?: unknown;
    localitySuitable?: unknown;
    reason?: unknown;
  } | null;
  if (!parsed || typeof parsed.intentSuitable !== 'boolean' || typeof parsed.localitySuitable !== 'boolean') {
    return { intentSuitable: true, localitySuitable: true, reason: null };
  }
  return {
    intentSuitable: parsed.intentSuitable,
    localitySuitable: parsed.localitySuitable,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
  };
}

// ---- classification ----
export function buildClassifyPrompt(keywords: string[], presets: SetupPresets): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        `Classify each keyword into one article_type from: ${ARTICLE_TYPES.join(', ')}. ` +
        'Use "other" only if none fit. Respond ONLY with JSON: ' +
        '{"types":[{"keyword":string,"article_type":string}]}.',
    },
    {
      role: 'user',
      content: `${businessContext(presets)}\n\nKeywords:\n${JSON.stringify(keywords)}`,
    },
  ];
}

export function parseClassification(text: string, keywords: string[]): Map<string, ArticleType> {
  const out = new Map<string, ArticleType>(keywords.map((k) => [k, 'other']));
  const parsed = tryParse(text) as { types?: Array<{ keyword?: unknown; article_type?: unknown }> } | null;
  for (const row of parsed?.types ?? []) {
    if (
      typeof row.keyword === 'string' &&
      typeof row.article_type === 'string' &&
      out.has(row.keyword) &&
      ARTICLE_TYPE_SET.has(row.article_type)
    ) {
      out.set(row.keyword, row.article_type as ArticleType);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- llm-prompts && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add LLM prompt builders + tolerant parsers\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: Relevance + opportunity scoring

**Files:**
- Create: `packages/shared/keywords/src/score.ts`
- Test: `packages/shared/keywords/tests/score.test.ts`

**Interfaces:**
- Consumes: `WorkingCandidate`, `ResolvedConfig`; `LlmClient`; `buildRelevancePrompt`/`parseRelevance` (Task 7); `SetupPresets`.
- Produces:
  - `applyRelevance(candidates, deps): Promise<WorkingCandidate[]>` — `deps = { llm: LlmClient; presets: SetupPresets }`; sets `relevance_score` (0 if none). Skips the LLM call when `candidates` is empty.
  - `scoreCandidates(candidates, opts): WorkingCandidate[]` — `opts = { cannibalSet: Set<string>; config: ResolvedConfig }`; sets `opportunity_score` (0–100) via the spec formula. Pure.

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/score.test.ts`:

```ts
import type { LlmClient } from '@shared/providers';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { applyRelevance, scoreCandidates } from '../src/score';
import type { WorkingCandidate } from '../src/types';

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: 't', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
  },
} as const;

const cand = (over: Partial<WorkingCandidate>): WorkingCandidate => ({
  keyword: 'dog food',
  normalized: 'dog food',
  source: 'keyword_ideas',
  source_context: null,
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: null,
  opportunity_score: null,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  ...over,
});

const llmReturning = (text: string): LlmClient => ({
  complete: vi.fn().mockResolvedValue({
    text,
    model: 'm',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
  }),
});

describe('applyRelevance', () => {
  it('sets relevance_score from the LLM response', async () => {
    const llm = llmReturning('{"scores":[{"keyword":"dog food","relevance":0.8}]}');
    const [out] = await applyRelevance([cand({})], { llm, presets });
    expect(out!.relevance_score).toBe(0.8);
  });

  it('does not call the LLM for an empty batch', async () => {
    const llm = llmReturning('{}');
    await applyRelevance([], { llm, presets });
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

describe('scoreCandidates', () => {
  it('computes a bounded 0..100 score from the weighted formula', () => {
    const [out] = scoreCandidates(
      [cand({ search_volume: 10_000, difficulty: 0, trend: 1, relevance_score: 1 })],
      { cannibalSet: new Set(), config },
    );
    // volume=1, ease=1, trend=1, relevance=1, cannibal absent -> full score
    expect(out!.opportunity_score).toBe(100);
  });

  it('penalizes cannibalization', () => {
    const base = cand({ search_volume: 100, difficulty: 20, relevance_score: 0.5, normalized: 'dog food' });
    const [clean] = scoreCandidates([base], { cannibalSet: new Set(), config });
    const [hit] = scoreCandidates([base], { cannibalSet: new Set(['dog food']), config });
    expect(hit!.opportunity_score!).toBeLessThan(clean!.opportunity_score!);
  });

  it('uses neutral 0.5 for null trend/difficulty and 0 for null volume', () => {
    const [out] = scoreCandidates([cand({ relevance_score: 0 })], { cannibalSet: new Set(), config });
    // relevance 0, volume 0, ease 0.5, trend 0.5, cannibal 0 ->
    // 100*(0.2*0.5 + 0.1*0.5 + 0.05*1) = 100*(0.1+0.05+0.05)=20
    expect(out!.opportunity_score).toBe(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- score`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/score.ts`**:

```ts
import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { buildRelevancePrompt, parseRelevance } from './llm-prompts';
import type { ResolvedConfig, WorkingCandidate } from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export async function applyRelevance(
  candidates: WorkingCandidate[],
  deps: { llm: LlmClient; presets: SetupPresets },
): Promise<WorkingCandidate[]> {
  if (candidates.length === 0) return candidates;
  const keywords = candidates.map((c) => c.keyword);
  const res = await deps.llm.complete({
    messages: buildRelevancePrompt(keywords, deps.presets),
    temperature: 0,
    responseFormat: 'json',
  });
  const scores = parseRelevance(res.text, keywords);
  return candidates.map((c) => ({ ...c, relevance_score: scores.get(c.keyword) ?? 0 }));
}

export function scoreCandidates(
  candidates: WorkingCandidate[],
  opts: { cannibalSet: Set<string>; config: ResolvedConfig },
): WorkingCandidate[] {
  const { weights, volumeCap } = opts.config;
  const logCap = Math.log10(volumeCap);
  return candidates.map((c) => {
    const volume = c.search_volume === null ? 0 : clamp01(Math.log10(c.search_volume + 1) / logCap);
    const relevance = clamp01(c.relevance_score ?? 0);
    const trend = c.trend === null ? 0.5 : clamp01(0.5 + c.trend / 2);
    const ease = c.difficulty === null ? 0.5 : 1 - clamp01(c.difficulty / 100);
    const cannibal = opts.cannibalSet.has(c.normalized) ? 1 : 0;
    const raw =
      weights.relevance * relevance +
      weights.volume * volume +
      weights.ease * ease +
      weights.trend * trend +
      weights.cannibalization * (1 - cannibal);
    return { ...c, opportunity_score: Math.round(100 * clamp01(raw)) };
  });
}
```

Note: the score is rounded to an integer 0–100 for stable equality in tests and readable UI values.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- score && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add relevance + opportunity scoring\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 9: Gather stage (provider fan-out + seed generation)

**Files:**
- Create: `packages/shared/keywords/src/gather.ts`
- Test: `packages/shared/keywords/tests/gather.test.ts`

**Interfaces:**
- Consumes: `DataForSeoClient`, `LlmClient`; `toWorking` (Task 3); `buildSeedPrompt`/`parseSeeds` (Task 7); `ResolvedConfig`, `SetupPresets`.
- Produces: `gatherCandidates(input, config): Promise<WorkingCandidate[]>` where `input = { websiteUrl; competitors; presets; clients: { dataForSeo; llm } }`. Calls `keywordsForSite` (website), `rankedKeywords` per competitor, generates seeds via LLM then `keywordIdeas`, tagging source/context. Returns the raw (un-deduped) list.

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/gather.test.ts`:

```ts
import type { DataForSeoClient, KeywordMetric, LlmClient } from '@shared/providers';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { gatherCandidates } from '../src/gather';

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };
const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: 't', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
  },
} as const;

const metric = (keyword: string): KeywordMetric => ({
  keyword,
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
});

it('fans out across site/competitors/ideas and tags provenance', async () => {
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([metric('site kw')]),
    rankedKeywords: vi.fn().mockResolvedValue([metric('comp kw')]),
    keywordIdeas: vi.fn().mockResolvedValue([metric('idea kw')]),
  } as unknown as DataForSeoClient;
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: '{"seeds":["dog food"]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  const out = await gatherCandidates(
    { websiteUrl: 'https://acme.io', competitors: ['comp.com'], presets, clients: { dataForSeo, llm } },
    config,
  );

  expect(out.map((c) => c.source).sort()).toEqual(['keyword_ideas', 'keywords_for_site', 'ranked_keywords']);
  expect(out.find((c) => c.source === 'ranked_keywords')!.source_context).toBe('comp.com');
  expect(dataForSeo.keywordIdeas).toHaveBeenCalledWith(
    expect.objectContaining({ keywords: ['dog food'] }),
  );
});

it('skips keywordIdeas when no seeds are produced', async () => {
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([]),
    rankedKeywords: vi.fn().mockResolvedValue([]),
    keywordIdeas: vi.fn(),
  } as unknown as DataForSeoClient;
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: '{"seeds":[]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  await gatherCandidates(
    { websiteUrl: 'https://acme.io', competitors: [], presets, clients: { dataForSeo, llm } },
    config,
  );
  expect(dataForSeo.keywordIdeas).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- gather`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/gather.ts`**:

```ts
import type { DataForSeoClient, LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { buildSeedPrompt, parseSeeds } from './llm-prompts';
import { toWorking } from './normalize';
import type { ResolvedConfig, WorkingCandidate } from './types';

interface GatherInput {
  websiteUrl: string;
  competitors: string[];
  presets: SetupPresets;
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
}

export async function gatherCandidates(
  input: GatherInput,
  config: ResolvedConfig,
): Promise<WorkingCandidate[]> {
  const { dataForSeo, llm } = input.clients;
  const geo = { locationName: config.locationName, languageName: config.languageName };
  const out: WorkingCandidate[] = [];

  const site = await dataForSeo.keywordsForSite({
    target: input.websiteUrl,
    limit: config.endpointLimits.keywordsForSite,
    ...geo,
  });
  for (const m of site) out.push(toWorking(m, 'keywords_for_site', input.websiteUrl));

  for (const competitor of input.competitors) {
    const ranked = await dataForSeo.rankedKeywords({
      target: competitor,
      limit: config.endpointLimits.rankedKeywords,
      ...geo,
    });
    for (const m of ranked) out.push(toWorking(m, 'ranked_keywords', competitor));
  }

  const seedRes = await llm.complete({
    messages: buildSeedPrompt(input.presets),
    temperature: 0,
    responseFormat: 'json',
  });
  const seeds = parseSeeds(seedRes.text);
  if (seeds.length > 0) {
    const ideas = await dataForSeo.keywordIdeas({
      keywords: seeds,
      limit: config.endpointLimits.keywordIdeas,
      ...geo,
    });
    for (const m of ideas) out.push(toWorking(m, 'keyword_ideas', seeds.join(', ')));
  }

  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- gather && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add gather stage (provider fan-out + LLM seeds)\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 10: SERP validation

**Files:**
- Create: `packages/shared/keywords/src/serp.ts`
- Test: `packages/shared/keywords/tests/serp.test.ts`

**Interfaces:**
- Consumes: `DataForSeoClient`, `LlmClient`, `SerpResult`; `reject` (Task 4); `buildSerpJudgmentPrompt`/`parseSerpJudgment` (Task 7); `ResolvedConfig`, `SetupPresets`, `WorkingCandidate`.
- Produces: `validateSerp(candidates, deps): Promise<{ accepted: WorkingCandidate[]; rejected: WorkingCandidate[] }>` — `deps = { dataForSeo; llm; presets; config }`. Iterates `candidates` (already the ranked top-N) in order; deterministic authority + duplicate checks, then one LLM judgment per candidate for intent/locality. Accepted keep `status: 'candidate'`; rejected carry the matching reason.

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/serp.test.ts`:

```ts
import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { validateSerp } from '../src/serp';
import type { WorkingCandidate } from '../src/types';

const config = {
  ...DEFAULT_CONFIG,
  serpTopK: 4,
  authorityThreshold: 0.5,
  duplicateSerpOverlap: 0.6,
  locationName: 'United States',
  languageName: 'English',
};
const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: 't', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
  },
} as const;

const cand = (keyword: string): WorkingCandidate => ({
  keyword,
  normalized: keyword,
  source: 'keyword_ideas',
  source_context: null,
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: null,
  opportunity_score: 50,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
});

const serp = (domains: string[]): SerpResult[] =>
  domains.map((d, i) => ({ rank: i + 1, url: `https://${d}/p${i}`, domain: d, title: `t${i}` }));

const okLlm = (): LlmClient => ({
  complete: vi.fn().mockResolvedValue({
    text: '{"intentSuitable":true,"localitySuitable":true,"reason":null}',
    model: 'm',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
  }),
});

it('rejects authority-dominated SERPs deterministically (no LLM call)', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn().mockResolvedValue(serp(['wikipedia.org', 'amazon.com', 'blogx.com', 'blogy.com'])),
  } as unknown as DataForSeoClient;
  const llm = okLlm();
  const { accepted, rejected } = await validateSerp([cand('k')], { dataForSeo, llm, presets, config });
  expect(accepted).toHaveLength(0);
  expect(rejected[0]!.rejection_reason).toBe('serp_authority');
  expect(llm.complete).not.toHaveBeenCalled();
});

it('rejects a duplicate SERP against an already-accepted candidate', async () => {
  const shared = serp(['a.com', 'b.com', 'c.com', 'd.com']);
  const dataForSeo = {
    serpGoogleOrganic: vi.fn().mockResolvedValueOnce(shared).mockResolvedValueOnce(shared),
  } as unknown as DataForSeoClient;
  const { accepted, rejected } = await validateSerp([cand('first'), cand('second')], {
    dataForSeo,
    llm: okLlm(),
    presets,
    config,
  });
  expect(accepted.map((c) => c.keyword)).toEqual(['first']);
  expect(rejected[0]!.rejection_reason).toBe('serp_duplicate');
});

it('uses the LLM to reject unsuitable intent', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn().mockResolvedValue(serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com'])),
  } as unknown as DataForSeoClient;
  const llm: LlmClient = {
    complete: vi.fn().mockResolvedValue({
      text: '{"intentSuitable":false,"localitySuitable":true,"reason":"transactional"}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  };
  const { rejected } = await validateSerp([cand('k')], { dataForSeo, llm, presets, config });
  expect(rejected[0]!.rejection_reason).toBe('serp_intent');
});

it('accepts a clean SERP', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn().mockResolvedValue(serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com'])),
  } as unknown as DataForSeoClient;
  const { accepted } = await validateSerp([cand('k')], { dataForSeo, llm: okLlm(), presets, config });
  expect(accepted).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- serp`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/serp.ts`**:

```ts
import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { reject } from './filters';
import { buildSerpJudgmentPrompt, parseSerpJudgment } from './llm-prompts';
import type { ResolvedConfig, WorkingCandidate } from './types';

interface SerpDeps {
  dataForSeo: DataForSeoClient;
  llm: LlmClient;
  presets: SetupPresets;
  config: ResolvedConfig;
}

function authorityFraction(serp: SerpResult[], topK: number, authority: Set<string>): number {
  const top = serp.slice(0, topK);
  if (top.length === 0) return 0;
  const hits = top.filter((r) => authority.has(r.domain.replace(/^www\./, ''))).length;
  return hits / top.length;
}

function urlSet(serp: SerpResult[], topK: number): Set<string> {
  return new Set(serp.slice(0, topK).map((r) => r.url));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const u of a) if (b.has(u)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function validateSerp(
  candidates: WorkingCandidate[],
  deps: SerpDeps,
): Promise<{ accepted: WorkingCandidate[]; rejected: WorkingCandidate[] }> {
  const { config } = deps;
  const authority = new Set(config.authorityDomains.map((d) => d.replace(/^www\./, '')));
  const acceptedSerps: Set<string>[] = [];
  const accepted: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];

  for (const c of candidates) {
    const serp = await deps.dataForSeo.serpGoogleOrganic({
      keyword: c.keyword,
      depth: config.serpDepth,
      locationName: config.locationName,
      languageName: config.languageName,
    });

    if (authorityFraction(serp, config.serpTopK, authority) >= config.authorityThreshold) {
      rejected.push(reject(c, 'serp_authority'));
      continue;
    }

    const urls = urlSet(serp, config.serpTopK);
    if (acceptedSerps.some((prev) => overlap(urls, prev) >= config.duplicateSerpOverlap)) {
      rejected.push(reject(c, 'serp_duplicate'));
      continue;
    }

    const res = await deps.llm.complete({
      messages: buildSerpJudgmentPrompt(c.keyword, serp, deps.presets),
      temperature: 0,
      responseFormat: 'json',
    });
    const judgment = parseSerpJudgment(res.text);
    if (!judgment.intentSuitable) {
      rejected.push(reject(c, 'serp_intent'));
      continue;
    }
    if (!judgment.localitySuitable) {
      rejected.push(reject(c, 'serp_locality'));
      continue;
    }

    acceptedSerps.push(urls);
    accepted.push(c);
  }

  return { accepted, rejected };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- serp && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add SERP validation (authority/duplicate/LLM judgment)\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 11: Article-type classification

**Files:**
- Create: `packages/shared/keywords/src/classify.ts`
- Test: `packages/shared/keywords/tests/classify.test.ts`

**Interfaces:**
- Consumes: `LlmClient`; `buildClassifyPrompt`/`parseClassification` (Task 7); `SetupPresets`, `WorkingCandidate`.
- Produces: `classifyCandidates(candidates, deps): Promise<WorkingCandidate[]>` — `deps = { llm; presets }`; sets `article_type`. Skips the LLM call for an empty batch.

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/classify.test.ts`:

```ts
import type { LlmClient } from '@shared/providers';
import { describe, expect, it, vi } from 'vitest';
import { classifyCandidates } from '../src/classify';
import type { WorkingCandidate } from '../src/types';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: 't', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
  },
} as const;

const cand = (keyword: string): WorkingCandidate => ({
  keyword,
  normalized: keyword,
  source: 'keyword_ideas',
  source_context: null,
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: null,
  opportunity_score: 50,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
});

it('assigns article_type from the LLM response', async () => {
  const llm: LlmClient = {
    complete: vi.fn().mockResolvedValue({
      text: '{"types":[{"keyword":"how to bathe a dog","article_type":"how_to_guide"}]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  };
  const [out] = await classifyCandidates([cand('how to bathe a dog')], { llm, presets });
  expect(out!.article_type).toBe('how_to_guide');
});

it('skips the LLM for an empty batch', async () => {
  const llm: LlmClient = { complete: vi.fn() };
  await classifyCandidates([], { llm, presets });
  expect(llm.complete).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- classify`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/classify.ts`**:

```ts
import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { buildClassifyPrompt, parseClassification } from './llm-prompts';
import type { WorkingCandidate } from './types';

export async function classifyCandidates(
  candidates: WorkingCandidate[],
  deps: { llm: LlmClient; presets: SetupPresets },
): Promise<WorkingCandidate[]> {
  if (candidates.length === 0) return candidates;
  const keywords = candidates.map((c) => c.keyword);
  const res = await deps.llm.complete({
    messages: buildClassifyPrompt(keywords, deps.presets),
    temperature: 0,
    responseFormat: 'json',
  });
  const types = parseClassification(res.text, keywords);
  return candidates.map((c) => ({ ...c, article_type: types.get(c.keyword) ?? 'other' }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- classify && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Add article-type classification stage\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 12: Pipeline orchestration + assembly

**Files:**
- Create: `packages/shared/keywords/src/pipeline.ts`
- Modify: `packages/shared/keywords/src/index.ts`
- Test: `packages/shared/keywords/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: every stage (Tasks 3–11), `resolveConfig` (Task 2).
- Produces: `runKeywordPipeline(input: PipelineInput): Promise<PipelineResult>`, exported from the package root.

- [ ] **Step 1: Write the failing test** — `packages/shared/keywords/tests/pipeline.test.ts`:

```ts
import type { DataForSeoClient, KeywordMetric, LlmClient, SerpResult } from '@shared/providers';
import { describe, expect, it } from 'vitest';
import { runKeywordPipeline } from '@shared/keywords';
import type { PipelineInput } from '@shared/keywords';

const metric = (keyword: string, over: Partial<KeywordMetric> = {}): KeywordMetric => ({
  keyword,
  search_volume: 100,
  difficulty: 20,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  ...over,
});

const serp = (domains: string[]): SerpResult[] =>
  domains.map((d, i) => ({ rank: i + 1, url: `https://${d}/p${i}`, domain: d, title: `t${i}` }));

// Deterministic fake LLM: routes by the system prompt's leading instruction.
function fakeLlm(): LlmClient {
  return {
    complete: async ({ messages }) => {
      const sys = messages[0]!.content;
      let text = '{}';
      if (sys.includes('seed keywords')) text = '{"seeds":["dog food"]}';
      else if (sys.includes('Score each keyword'))
        text = '{"scores":[{"keyword":"cheap dog food","relevance":0.9},{"keyword":"dog food delivery","relevance":0.8}]}';
      else if (sys.includes('could rank'))
        text = '{"intentSuitable":true,"localitySuitable":true,"reason":null}';
      else if (sys.includes('Classify each keyword'))
        text = '{"types":[{"keyword":"cheap dog food","article_type":"listicle"},{"keyword":"dog food delivery","article_type":"product_guide"}]}';
      return { text, model: 'm', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null } };
    },
  };
}

function fakeDataForSeo(): DataForSeoClient {
  return {
    keywordsForSite: async () => [metric('cheap dog food')],
    rankedKeywords: async () => [metric('dog food delivery')],
    keywordIdeas: async () => [metric('acme login', { difficulty: 5 }), metric('premium dog food', { difficulty: 90 })],
    bulkKeywordDifficulty: async () => [],
    // Distinct domains per keyword so SERPs never trip the duplicate-overlap check.
    serpGoogleOrganic: async ({ keyword }) => {
      const slug = keyword.replace(/\s/g, '');
      return serp([`${slug}-a.com`, `${slug}-b.com`, `${slug}-c.com`, `${slug}-d.com`]);
    },
  } as unknown as DataForSeoClient;
}

const input = (): PipelineInput => ({
  orgId: 'org1',
  websiteUrl: 'https://acme.io',
  presets: {
    business: { name: 'Acme', language: 'English', country: 'United States', description: 'pet food' },
    audience: { target: 'dog owners', competitors: ['comp.com'] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
      engagement: { image_style: '' },
    },
  },
  competitors: ['comp.com'],
  existingKeywords: [],
  existingArticleKeywords: [],
  clients: { dataForSeo: fakeDataForSeo(), llm: fakeLlm() },
});

describe('runKeywordPipeline', () => {
  it('produces accepted, classified candidates and records rejections with reasons', async () => {
    const { candidates, stats } = await runKeywordPipeline(input());

    const brand = candidates.find((c) => c.keyword === 'acme login');
    expect(brand!.status).toBe('rejected');
    expect(brand!.rejection_reason).toBe('brand_navigation');

    const overKd = candidates.find((c) => c.keyword === 'premium dog food');
    expect(overKd!.rejection_reason).toBe('difficulty_ceiling');

    const accepted = candidates.filter((c) => c.status === 'candidate' && c.article_type !== null);
    expect(accepted.map((c) => c.article_type).sort()).toEqual(['listicle', 'product_guide']);
    expect(accepted.every((c) => c.org_id === 'org1')).toBe(true);
    expect(stats.accepted).toBe(2);
  });

  it('is deterministic for fixed provider responses', async () => {
    const a = await runKeywordPipeline(input());
    const b = await runKeywordPipeline(input());
    expect(a).toEqual(b);
  });

  it('limits SERP validation to serpTopN', async () => {
    let serpCalls = 0;
    const dfs = fakeDataForSeo();
    const wrapped: DataForSeoClient = {
      ...dfs,
      serpGoogleOrganic: async (p) => {
        serpCalls++;
        return dfs.serpGoogleOrganic(p);
      },
    };
    await runKeywordPipeline({
      ...input(),
      clients: { dataForSeo: wrapped, llm: fakeLlm() },
      config: { serpTopN: 1 },
    });
    expect(serpCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- pipeline`
Expected: FAIL — `runKeywordPipeline` not exported.

- [ ] **Step 3: Implement `src/pipeline.ts`**:

```ts
import type { RejectionReason } from '@shared/schemas';
import { classifyCandidates } from './classify';
import { clusterCandidates } from './cluster';
import { resolveConfig } from './config';
import { applyDifficultyCeiling, brandNavFilter, fillDifficulty } from './filters';
import { gatherCandidates } from './gather';
import { dedupe } from './normalize';
import { applyRelevance, scoreCandidates } from './score';
import { validateSerp } from './serp';
import type {
  EnrichedCandidate,
  PipelineInput,
  PipelineResult,
  WorkingCandidate,
} from './types';

const EMPTY_REASON_COUNTS: Record<RejectionReason, number> = {
  brand_navigation: 0,
  clustered_duplicate: 0,
  difficulty_ceiling: 0,
  serp_intent: 0,
  serp_authority: 0,
  serp_locality: 0,
  serp_duplicate: 0,
};

function toEnriched(c: WorkingCandidate, orgId: string): EnrichedCandidate {
  return {
    org_id: orgId,
    keyword: c.keyword,
    source: c.source,
    source_context: c.source_context,
    search_volume: c.search_volume,
    difficulty: c.difficulty,
    cpc: c.cpc,
    competition: c.competition,
    trend: c.trend,
    intent: c.intent,
    relevance_score: c.relevance_score,
    opportunity_score: c.opportunity_score,
    article_type: c.article_type,
    rejection_reason: c.rejection_reason,
    status: c.status,
  };
}

function rankKey(a: WorkingCandidate, b: WorkingCandidate): number {
  return (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) || a.normalized.localeCompare(b.normalized);
}

export async function runKeywordPipeline(input: PipelineInput): Promise<PipelineResult> {
  const config = resolveConfig(input.presets, input.config);
  const rejected: WorkingCandidate[] = [];

  // 1 gather → 2 dedupe
  const raw = await gatherCandidates(
    {
      websiteUrl: input.websiteUrl,
      competitors: input.competitors,
      presets: input.presets,
      clients: input.clients,
    },
    config,
  );
  const gathered = raw.length;
  const deduped = dedupe(raw);

  // 3 brand/nav
  const brand = brandNavFilter(deduped, { orgName: input.presets.business.name, websiteUrl: input.websiteUrl });
  rejected.push(...brand.rejected);

  // 4 cluster
  const clustered = clusterCandidates(brand.survivors, config.clusterJaccard);
  rejected.push(...clustered.rejected);

  // 5 fill difficulty → 6 ceiling
  const filled = await fillDifficulty(clustered.survivors, { dataForSeo: input.clients.dataForSeo, config });
  const ceiling = applyDifficultyCeiling(filled, config.difficultyCeiling);
  rejected.push(...ceiling.rejected);

  // 7 relevance → 8 score
  const withRelevance = await applyRelevance(ceiling.survivors, {
    llm: input.clients.llm,
    presets: input.presets,
  });
  const cannibalSet = new Set([...input.existingKeywords, ...input.existingArticleKeywords]);
  const scored = scoreCandidates(withRelevance, { cannibalSet, config });

  // 9 rank + split top-N
  const ranked = [...scored].sort(rankKey);
  const topN = ranked.slice(0, config.serpTopN);
  const belowN = ranked.slice(config.serpTopN);

  // 10 SERP validate → 11 classify
  const serp = await validateSerp(topN, {
    dataForSeo: input.clients.dataForSeo,
    llm: input.clients.llm,
    presets: input.presets,
    config,
  });
  rejected.push(...serp.rejected);
  const classified = await classifyCandidates(serp.accepted, {
    llm: input.clients.llm,
    presets: input.presets,
  });

  // 12 assemble (stable order: accepted, then below-N scored, then rejected)
  const all: WorkingCandidate[] = [...classified, ...belowN, ...rejected];
  const rejectedByReason = { ...EMPTY_REASON_COUNTS };
  for (const c of rejected) if (c.rejection_reason) rejectedByReason[c.rejection_reason]++;

  return {
    candidates: all.map((c) => toEnriched(c, input.orgId)),
    stats: {
      gathered,
      afterDedupe: deduped.length,
      afterBrandNav: brand.survivors.length,
      clustered: clustered.rejected.length,
      afterCeiling: ceiling.survivors.length,
      scored: scored.length,
      serpValidated: topN.length,
      accepted: classified.length,
      rejectedByReason,
    },
  };
}
```

- [ ] **Step 4: Export from `src/index.ts`** — replace its contents:

```ts
export type * from './types';
export { DEFAULT_CONFIG, resolveConfig } from './config';
export { runKeywordPipeline } from './pipeline';
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- pipeline && npm run check:all`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Full gate + commit**

```bash
npm run lint && npm run check:all && npm test
npm run lint:fix
git add packages/shared/keywords
git commit -m "$(printf '[dashboard] Wire keyword opportunity pipeline end-to-end (#54)\n\nBuilds the deterministic gather->score->SERP-validate->classify pipeline\nas a pure @shared/keywords library. Consumed later by #47/#50.\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 13: Update PROGRESS.md

**Files:**
- Modify: `PROGRESS.md:45`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the keyword-research line** — change the `🟡` entry that currently ends "not yet wired to a consumer — [#49]" to note #54 landed. Replace the line at `PROGRESS.md:45` with:

```markdown
- 🟡 Keyword pipeline built: `@shared/providers` DataForSEO client + org-scoped candidate pool ([#49]) and `@shared/keywords` scoring/SERP-validation/classification pipeline ([#54]) — pure library, not yet wired to a consumer ([#47]/[#50])
```

(Keep the existing `[#49]` link target; add `[#54]`/`[#47]`/`[#50]` link references consistent with the file's inline-link style.)

- [ ] **Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "$(printf '[dashboard] PROGRESS: keyword opportunity pipeline landed (#54)\n\nPart of #54\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Verification (whole feature)

Run the full gate from the repo root:

```bash
npm run lint && npm run check:all && npm test
```

Expected: lint clean, typecheck clean, all `packages/shared/keywords` + `candidate` tests green. No integration infra needed (the pipeline is pure).

## Spec coverage check

- Gather (website/competitors/seeds) → Task 9. Seeds from metadata via LLM → Tasks 7, 9.
- Normalize + dedupe → Task 3. Brand/nav removal → Task 4. Cluster near-dupes → Task 6.
- Batched difficulty fill, skipped when present → Task 5.
- Opportunity score (volume/relevance/trend/difficulty/cannibalization) → Task 8.
- Difficulty ceiling 45 → Task 5.
- SERP validation of top-N; intent/authority/locality/duplicate rejects → Task 10; top-N config → Tasks 2, 12.
- Article-type classification (constrained enum + `other`) → Tasks 1, 7, 11.
- Provenance + rejection reason retained on every candidate → Tasks 3–12 (each `reject` keeps source/context; assembly in Task 12).
- Deterministic for fixed responses → Task 12 determinism test; stable sorts throughout.
- Constrained intent enum → reuses `SEARCH_INTENTS` (#49); constrained article-type/rejection enums → Task 1.
- Unit tests for scoring/filtering/dedup/classification boundaries → Tasks 3–12.
