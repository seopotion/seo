import type { DataForSeoClient, SerpResult } from '@shared/providers';
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { validateSerp } from '../src/serp';
import type { WorkingCandidate } from '../src/types';

const config = {
  ...DEFAULT_CONFIG,
  serpTopK: 4,
  authorityThreshold: 0.5,
  locationName: 'United States',
  languageName: 'English',
};

const cand = (keyword: string): WorkingCandidate => ({
  keyword,
  normalized: keyword,
  source: 'keyword_ideas',
  source_context: null,
  core_keyword: null,
  category_ids: [],
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
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
  serp_competitors: null,
  serp_validated: false,
});

const serp = (domains: string[]): SerpResult[] =>
  domains.map((d, i) => ({ rank: i + 1, url: `https://${d}/p${i}`, domain: d, title: `t${i}` }));

it('rejects authority-dominated SERPs', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['wikipedia.org', 'amazon.com', 'blogx.com', 'blogy.com'])),
  } as unknown as DataForSeoClient;
  const { accepted, rejected } = await validateSerp([cand('k')], { dataForSeo, config });
  expect(accepted).toHaveLength(0);
  expect(rejected[0]!.rejection_reason).toBe('serp_authority');
});

it('accepts a clean SERP and stamps serp_validated false', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com'])),
  } as unknown as DataForSeoClient;
  const { accepted, rejected } = await validateSerp([cand('k')], { dataForSeo, config });
  expect(accepted).toHaveLength(1);
  expect(accepted[0]!.serp_validated).toBe(false);
  expect(rejected).toEqual([]);
});

it('accepts candidates with identical SERPs and retains evidence for both', async () => {
  const shared = serp(['a.com', 'b.com', 'c.com', 'd.com']);
  const dataForSeo = {
    serpGoogleOrganic: vi.fn().mockResolvedValueOnce(shared).mockResolvedValueOnce(shared),
  } as unknown as DataForSeoClient;
  const { accepted, rejected } = await validateSerp([cand('first'), cand('second')], {
    dataForSeo,
    config,
  });
  expect(accepted.map((c) => c.keyword)).toEqual(['first', 'second']);
  expect(rejected).toEqual([]);
  expect(accepted.every((candidate) => candidate.serp_competitors?.length === 4)).toBe(true);
});

it('fetches SERPs concurrently and preserves input order', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const shared = serp(['a.com', 'b.com', 'c.com', 'd.com']);
  const dataForSeo = {
    // 'dup' mirrors 'first'; both must remain available to semantic clustering.
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return keyword === 'first' || keyword === 'dup' ? shared : serp([`${keyword}.com`]);
    }),
  } as unknown as DataForSeoClient;

  const cands = ['first', 'k2', 'k3', 'dup'].map(cand);
  const { accepted, rejected } = await validateSerp(cands, { dataForSeo, config });

  expect(maxInFlight).toBeGreaterThan(1); // ran in parallel
  expect(accepted.map((c) => c.keyword)).toEqual(['first', 'k2', 'k3', 'dup']);
  expect(rejected).toEqual([]);
});

// A live SERP call is the one thing in this stage that talks to a flaky third
// party. Before this, one keyword's 40101 rejected the whole Promise.all and
// killed a production strategy run 4 stages deep. A keyword we could not fetch
// is unvalidated, not rejected — it survives into the below-N tier where
// `serp_validated: false` keeps it unschedulable.
it('keeps the batch alive when one SERP fetch fails and marks that keyword unvalidated', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) => {
      if (keyword === 'boom') throw new Error('DataForSEO request failed (provider)');
      return serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com']);
    }),
  } as unknown as DataForSeoClient;

  const { accepted, rejected, unvalidated } = await validateSerp(
    ['k1', 'boom', 'k3', 'k4', 'k5'].map(cand),
    { dataForSeo, config },
  );

  expect(accepted.map((c) => c.keyword)).toEqual(['k1', 'k3', 'k4', 'k5']);
  expect(unvalidated.map((c) => c.keyword)).toEqual(['boom']);
  expect(unvalidated[0]!.serp_validated).toBe(false);
  expect(unvalidated[0]!.rejection_reason).toBeNull();
  expect(rejected).toEqual([]);
});

it('aborts when the failed share of SERP fetches exceeds maxSerpFailureRate', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) => {
      if (keyword !== 'ok') throw new Error('DataForSEO request failed (provider)');
      return serp(['blogx.com']);
    }),
  } as unknown as DataForSeoClient;

  await expect(
    validateSerp(['ok', 'a', 'b', 'c'].map(cand), {
      dataForSeo,
      config: { ...config, maxSerpFailureRate: 0.5 },
    }),
  ).rejects.toThrow(/3 of 4/);
});

it('tolerates failures at exactly maxSerpFailureRate', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) => {
      if (keyword === 'boom') throw new Error('DataForSEO request failed (provider)');
      return serp(['blogx.com']);
    }),
  } as unknown as DataForSeoClient;

  const { accepted, unvalidated } = await validateSerp(['boom', 'k2', 'k3', 'k4'].map(cand), {
    dataForSeo,
    config: { ...config, maxSerpFailureRate: 0.25 },
  });

  expect(accepted).toHaveLength(3);
  expect(unvalidated).toHaveLength(1);
});
