import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { applyRelevance, scoreCandidates } from '../src/score';
import type { WorkingCandidate } from '../src/types';

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };

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

const cand = (over: Partial<WorkingCandidate>): WorkingCandidate => ({
  keyword: 'dog food',
  normalized: 'dog food',
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
  opportunity_score: null,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  serp_competitors: null,
  serp_validated: false,
  ...over,
});

const llmReturning = (text: string): LlmClient => ({
  complete: vi.fn().mockResolvedValue({
    text,
    model: 'm',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
  }),
});

/** The keywords one batched relevance call was asked about, in prompt order. */
const promptKeywords = (params: { messages: { role: string; content: string }[] }): string[] => {
  const user = params.messages.find((m) => m.role === 'user') as { content: string };
  return user.content
    .split('Keywords:\n')[1]!
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s/, ''));
};

/** Answers every keyword it is asked about with `score`, by index. */
const scoringLlm = (score: (keyword: string) => number | null): LlmClient => ({
  complete: vi.fn(async (params: Parameters<LlmClient['complete']>[0]) => {
    const rows = promptKeywords(params)
      .map((keyword, index) => ({ index, relevance: score(keyword) }))
      .filter((r) => r.relevance !== null);
    return {
      text: JSON.stringify({ scores: rows }),
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    };
  }),
});

const many = (n: number): WorkingCandidate[] =>
  Array.from({ length: n }, (_, i) => cand({ keyword: `kw ${i}`, normalized: `kw ${i}` }));

describe('applyRelevance', () => {
  it('sets relevance_score from the LLM response', async () => {
    const llm = llmReturning('{"scores":[{"index":0,"relevance":0.8}]}');
    const { candidates, coverage } = await applyRelevance([cand({})], { llm, presets });
    expect(candidates[0]!.relevance_score).toBe(0.8);
    expect(coverage).toEqual({ sent: 1, returned: 1, zero: 0, batches: 1, failedBatches: 0 });
  });

  // The distinction item 2 turns on: a keyword the model never scored must stay
  // NULL, because the relevance floor rejects at 0 and would otherwise delete it.
  it('leaves a keyword the LLM skipped at null, not 0', async () => {
    const llm = llmReturning('{"scores":[{"index":0,"relevance":0.8}]}');
    const { candidates, coverage } = await applyRelevance(
      [cand({}), cand({ keyword: 'cat food', normalized: 'cat food' })],
      { llm, presets },
    );
    expect(candidates[1]!.relevance_score).toBeNull();
    expect(coverage).toEqual({ sent: 2, returned: 1, zero: 0, batches: 1, failedBatches: 0 });
  });

  it('counts only scores the model actually returned as 0', async () => {
    const llm = llmReturning('{"scores":[{"index":0,"relevance":0}]}');
    const { candidates, coverage } = await applyRelevance(
      [cand({}), cand({ keyword: 'cat food', normalized: 'cat food' })],
      { llm, presets },
    );
    expect(candidates[0]!.relevance_score).toBe(0);
    expect(coverage.zero).toBe(1);
  });

  it('does not call the LLM for an empty batch', async () => {
    const llm = llmReturning('{}');
    const { coverage } = await applyRelevance([], { llm, presets });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(coverage).toEqual({ sent: 0, returned: 0, zero: 0, batches: 0, failedBatches: 0 });
  });

  it('splits a large pool into batches and scores every candidate', async () => {
    const llm = scoringLlm(() => 0.5);
    const { candidates, coverage } = await applyRelevance(many(120), { llm, presets });

    expect(coverage.batches).toBe(3); // RELEVANCE_BATCH_SIZE 50
    expect(coverage).toMatchObject({ sent: 120, returned: 120, failedBatches: 0 });
    expect(candidates.every((c) => c.relevance_score === 0.5)).toBe(true);
    expect(llm.complete).toHaveBeenCalledTimes(3);
    // Every call carries a disjoint slice, in input order.
    const asked = (llm.complete as ReturnType<typeof vi.fn>).mock.calls.flatMap(([p]) =>
      promptKeywords(p),
    );
    expect(asked).toEqual(many(120).map((c) => c.keyword));
  });

  // One bad body must cost its own 50 keywords and nothing else — the whole
  // reason the stage was batched (#211). The dead batch here fails BOTH its
  // first attempt and its repair retry, so it is still counted failed.
  it('degrades per batch: a body unparseable on both attempts leaves only its own keywords unscored', async () => {
    const good = scoringLlm(() => 0.5);
    const empty = {
      text: '',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    };
    const llm: LlmClient = {
      complete: vi.fn(async (params) =>
        promptKeywords(params)[0] === 'kw 50' ? empty : good.complete(params),
      ),
    };

    const { candidates, coverage } = await applyRelevance(many(150), { llm, presets });

    expect(coverage).toEqual({
      sent: 150,
      returned: 100,
      zero: 0,
      batches: 3,
      failedBatches: 1,
    });
    // The dead batch is the middle 50; its neighbours are untouched.
    expect(candidates.slice(0, 50).every((c) => c.relevance_score === 0.5)).toBe(true);
    expect(candidates.slice(50, 100).every((c) => c.relevance_score === null)).toBe(true);
    expect(candidates.slice(100).every((c) => c.relevance_score === 0.5)).toBe(true);
    // One initial attempt + one repair retry for the dead batch, one call each
    // for the two healthy batches.
    expect(llm.complete).toHaveBeenCalledTimes(4);
  });

  it('retries a batch once after an unparseable body, before counting it failed', async () => {
    let calls = 0;
    const llm: LlmClient = {
      complete: vi.fn(async (params) => {
        calls++;
        if (calls === 1) {
          return {
            text: '',
            model: 'm',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
          };
        }
        const keywords = promptKeywords(params);
        return {
          text: JSON.stringify({
            scores: keywords.map((_k, index) => ({ index, relevance: 0.5 })),
          }),
          model: 'm',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
        };
      }),
    };

    const { candidates, coverage } = await applyRelevance([cand({})], { llm, presets });

    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(candidates[0]!.relevance_score).toBe(0.5);
    expect(coverage).toEqual({ sent: 1, returned: 1, zero: 0, batches: 1, failedBatches: 0 });
    const secondMessages = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[1]![0].messages;
    expect(secondMessages.some((m: { role: string }) => m.role === 'assistant')).toBe(true);
    expect(secondMessages.at(-1)!.content).toMatch(/could not be parsed/i);
  });

  it('passes the per-stage model override to every batch', async () => {
    const llm = scoringLlm(() => 0.5);
    await applyRelevance(many(60), { llm, presets, model: 'anthropic/claude-haiku-4.5' });
    for (const [params] of (llm.complete as ReturnType<typeof vi.fn>).mock.calls) {
      expect(params.model).toBe('anthropic/claude-haiku-4.5');
    }
  });
});

describe('scoreCandidates', () => {
  it('computes a bounded 0..100 score from the weighted formula', () => {
    const [out] = scoreCandidates(
      // KD 1, not 0: at this volume a 0 reads as missing data and scores neutral.
      [cand({ search_volume: 10_000, difficulty: 1, trend: 1, relevance_score: 1 })],
      { cannibalSet: new Set(), config },
    );
    // volume=1, ease=0.99, trend=1, relevance=1, cannibal absent -> full score
    expect(out!.opportunity_score).toBe(100);
  });

  it('penalizes cannibalization', () => {
    const base = cand({
      search_volume: 100,
      difficulty: 20,
      relevance_score: 0.5,
      normalized: 'dog food',
    });
    const [clean] = scoreCandidates([base], { cannibalSet: new Set(), config });
    const [hit] = scoreCandidates([base], { cannibalSet: new Set(['dog food']), config });
    expect(hit!.opportunity_score!).toBeLessThan(clean!.opportunity_score!);
  });

  // DataForSEO reports difficulty 0 both for genuinely trivial keywords and for
  // keywords it has no KD data on; volume is the tell (#211).
  describe('difficulty 0', () => {
    // Volume feeds the score directly, so every comparison holds it fixed and
    // varies only `difficulty`.
    const scoreAt = (difficulty: number | null, search_volume: number): number => {
      const [out] = scoreCandidates([cand({ relevance_score: 0, difficulty, search_volume })], {
        cannibalSet: new Set(),
        config,
      });
      return out!.opportunity_score as number;
    };

    it('scores KD 0 at high volume like a null KD — both mean "unknown"', () => {
      expect(scoreAt(0, 5000)).toBe(scoreAt(null, 5000));
    });

    it('keeps KD 0 at low volume at maximum ease — plausible long-tail', () => {
      expect(scoreAt(0, 50)).toBeGreaterThan(scoreAt(null, 50));
    });

    it('treats the volume threshold as exclusive', () => {
      expect(scoreAt(0, 1000)).toBeGreaterThan(scoreAt(null, 1000)); // still max ease
      expect(scoreAt(0, 1001)).toBe(scoreAt(null, 1001)); // unknown
    });

    it('leaves a real difficulty untouched at any volume', () => {
      // KD 40 -> ease 0.6: above the 0.5 an unknown KD gets, below the 1.0 a
      // genuine long-tail KD 0 keeps.
      expect(scoreAt(40, 5000)).toBeGreaterThan(scoreAt(0, 5000));
      expect(scoreAt(40, 50)).toBeLessThan(scoreAt(0, 50));
    });
  });

  it('uses neutral 0.5 for null trend/difficulty and 0 for null volume', () => {
    const [out] = scoreCandidates([cand({ relevance_score: 0 })], {
      cannibalSet: new Set(),
      config,
    });
    // relevance 0, volume 0, ease 0.5, trend 0.5, cannibal 0 ->
    // 100*(0.2*0.5 + 0.1*0.5 + 0.05*1) = 100*(0.1+0.05+0.05)=20
    expect(out!.opportunity_score).toBe(20);
  });
});
