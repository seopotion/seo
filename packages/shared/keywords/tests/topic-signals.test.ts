import { CandidateSchema } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import { compareTopicSignals } from '../src/topic-signals';

describe('compareTopicSignals', () => {
  it('reports the same core keyword for normalized wording variants', () => {
    const singular = { keyword: 'reverse osmosis membrane', core_keyword: 'RO Membrane' };
    const plural = { keyword: 'reverse osmosis membranes', core_keyword: '  ro   membrane ' };

    expect(compareTopicSignals(singular, plural).core_keyword_relation).toBe('same');
  });

  it('distinguishes different core keywords from unknown evidence', () => {
    expect(
      compareTopicSignals(
        { core_keyword: 'membrane cleaning' },
        { core_keyword: 'membrane replacement' },
      ).core_keyword_relation,
    ).toBe('different');
    expect(
      compareTopicSignals({ core_keyword: null }, { core_keyword: null }).core_keyword_relation,
    ).toBe('unknown');
    expect(
      compareTopicSignals({ core_keyword: '   ' }, { core_keyword: 'membrane' })
        .core_keyword_relation,
    ).toBe('unknown');
  });

  it('calculates partial Jaccard overlap from unique non-null SERP URLs', () => {
    const evidence = compareTopicSignals(
      {
        serp_competitors: [
          { url: 'https://a.com' },
          { url: 'https://b.com' },
          { url: 'https://b.com' },
          { url: 'https://c.com' },
          { url: null },
        ],
      },
      {
        serp_competitors: [
          { url: 'https://b.com' },
          { url: 'https://c.com' },
          { url: 'https://d.com' },
        ],
      },
    );

    expect(evidence.serp_url_overlap).toBe(0.5);
  });

  it('distinguishes measured zero overlap from unavailable SERP evidence', () => {
    expect(
      compareTopicSignals(
        { serp_competitors: [{ url: 'https://a.example' }] },
        { serp_competitors: [{ url: 'https://b.example' }] },
      ).serp_url_overlap,
    ).toBe(0);

    const legacy = CandidateSchema.parse({
      id: 'c1',
      org_id: 'o1',
      keyword: 'legacy keyword',
      normalized_keyword: 'legacy keyword',
      source: 'keyword_ideas',
      serp_competitors: ['legacy.example'],
      created_at: new Date(),
      updated_at: new Date(),
    });

    expect(compareTopicSignals(legacy, {}).serp_url_overlap).toBeNull();
    expect(compareTopicSignals({}, {}).serp_url_overlap).toBeNull();
    expect(
      compareTopicSignals(
        { serp_competitors: [{ url: '   ' }] },
        { serp_competitors: [{ url: 'https://a.example' }] },
      ).serp_url_overlap,
    ).toBeNull();
  });

  it('distinguishes unavailable, empty, and non-empty category intersections', () => {
    expect(compareTopicSignals({}, { category_ids: [10] }).shared_category_ids).toBeNull();
    expect(
      compareTopicSignals({ category_ids: [] }, { category_ids: [] }).shared_category_ids,
    ).toBeNull();
    expect(
      compareTopicSignals({ category_ids: [30, 10, 30, 90] }, { category_ids: [40, 30, 10, 10] })
        .shared_category_ids,
    ).toEqual([10, 30]);
    expect(
      compareTopicSignals({ category_ids: [10, 20] }, { category_ids: [30, 40] })
        .shared_category_ids,
    ).toEqual([]);
  });
});
