import { expect, test, vi } from 'vitest';
import { validateSerp } from '../src/serp';
import type { ResolvedConfig, WorkingCandidate } from '../src/types';

function candidate(keyword: string): WorkingCandidate {
  return {
    keyword,
    normalized: keyword,
    source: 'seed',
    source_context: null,
    core_keyword: null,
    category_ids: [],
    topic_cluster_id: null,
    topic_cluster_label: null,
    topic_role: null,
    topic_content_focus: null,
    topic_primary_keyword: null,
    search_volume: 100,
    difficulty: 10,
    cpc: null,
    competition: null,
    trend: null,
    intent: 'informational',
    relevance_score: 1,
    opportunity_score: 1,
    article_type: null,
    rejection_reason: null,
    status: 'candidate',
    serp_competitors: null,
    serp_validated: false,
  };
}

const config = {
  serpTopK: 3,
  serpDepth: 10,
  authorityDomains: [],
  authorityThreshold: 0.9,
  models: {},
} as unknown as ResolvedConfig;

test('accepted candidates carry the top-K SERP entries', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async () => [
      { rank: 1, url: 'https://a.com/1', domain: 'a.com', title: 'A' },
      { rank: 2, url: 'https://b.com/1', domain: 'b.com', title: 'B' },
      { rank: 3, url: 'https://c.com/1', domain: 'c.com', title: 'C' },
      { rank: 4, url: 'https://d.com/1', domain: 'd.com', title: 'D' },
    ]),
  };
  const { accepted } = await validateSerp([candidate('best crm')], {
    dataForSeo: dataForSeo as never,
    config,
  });
  expect(accepted[0]!.serp_competitors).toEqual([
    { rank: 1, url: 'https://a.com/1', domain: 'a.com', title: 'A' },
    { rank: 2, url: 'https://b.com/1', domain: 'b.com', title: 'B' },
    { rank: 3, url: 'https://c.com/1', domain: 'c.com', title: 'C' },
  ]);
});
