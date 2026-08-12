import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it, vi } from 'vitest';
import { CLASSIFY_BATCH_SIZE, classifyCandidates } from '../src/classify';
import type { WorkingCandidate } from '../src/types';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: ['t'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: {
      article_style: '',
      internal_links_count: 0,
      table_of_contents: true,
      llm_instructions: '',
    },
    engagement: { image_style: '', youtube_videos: true },
    publishing: { auto_publish: false },
  },
} satisfies SetupPresets;

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

const reply = (text: string) => ({
  text,
  model: 'm',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
});

/** Answers every index with `type`, mirroring the numbered prompt. */
const typingLlm = (type: string): LlmClient => ({
  complete: vi.fn(async ({ messages }: { messages: { content: string }[] }) => {
    const count = (messages.at(-1)?.content ?? '')
      .split('\n')
      .filter((l) => /^\d+\. /.test(l)).length;
    return reply(
      JSON.stringify({
        types: Array.from({ length: count }, (_, index) => ({ index, article_type: type })),
      }),
    );
  }),
});

describe('classifyCandidates', () => {
  it('assigns article_type from the LLM response', async () => {
    const llm: LlmClient = {
      complete: vi
        .fn()
        .mockResolvedValue(reply('{"types":[{"index":0,"article_type":"How-To Guide"}]}')),
    };
    const { candidates, coverage } = await classifyCandidates([cand('how to bathe a dog')], {
      llm,
      presets,
    });
    expect(candidates[0]!.article_type).toBe('how_to_guide');
    expect(coverage).toEqual({
      sent: 1,
      returned: 1,
      matched: 1,
      typed: 1,
      assigned: 1,
      batches: 1,
      failedBatches: 0,
    });
  });

  it('skips the LLM for an empty batch', async () => {
    const llm: LlmClient = { complete: vi.fn() };
    const { coverage } = await classifyCandidates([], { llm, presets });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(coverage.batches).toBe(0);
  });

  // One call for the whole pool is what let a single empty body wipe out all 78
  // article types on the clewas run (#211).
  it('splits a large pool into batches and merges their types', async () => {
    const llm = typingLlm('listicle');
    const cands = Array.from({ length: CLASSIFY_BATCH_SIZE * 2 + 3 }, (_, i) => cand(`k${i}`));
    const { candidates, coverage } = await classifyCandidates(cands, { llm, presets });

    expect((llm.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect(candidates.every((c) => c.article_type === 'listicle')).toBe(true);
    expect(coverage.batches).toBe(3);
    expect(coverage.sent).toBe(cands.length);
    expect(coverage.assigned).toBe(cands.length);
  });

  // The blast radius: one dead call must cost its own batch, not the pool.
  it('contains a dead batch — its keywords seed to other, the rest keep their types', async () => {
    let call = 0;
    const llm: LlmClient = {
      complete: vi.fn(async ({ messages }: { messages: { content: string }[] }) => {
        const count = (messages.at(-1)?.content ?? '')
          .split('\n')
          .filter((l) => /^\d+\. /.test(l)).length;
        // The observed failure: an empty body after burning the output budget.
        if (call++ === 0) return reply('');
        return reply(
          JSON.stringify({
            types: Array.from({ length: count }, (_, index) => ({
              index,
              article_type: 'definition',
            })),
          }),
        );
      }),
    };
    const cands = Array.from({ length: CLASSIFY_BATCH_SIZE * 2 }, (_, i) => cand(`k${i}`));
    const { candidates, coverage } = await classifyCandidates(cands, { llm, presets });

    const first = candidates.slice(0, CLASSIFY_BATCH_SIZE);
    const second = candidates.slice(CLASSIFY_BATCH_SIZE);
    expect(first.every((c) => c.article_type === 'other')).toBe(true);
    expect(second.every((c) => c.article_type === 'definition')).toBe(true);
    expect(coverage.failedBatches).toBe(1);
    expect(coverage.batches).toBe(2);
    expect(coverage.assigned).toBe(CLASSIFY_BATCH_SIZE);
  });
});
