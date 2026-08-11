import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { SERP_JUDGE_BATCH_SIZE, validateSerp } from '../src/serp';
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

const reply = (text: string) => ({
  text,
  model: 'm',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
});

/** The keywords one batched judge prompt covers, in prompt order. */
const promptKeywords = (content: string): string[] =>
  [...content.matchAll(/^Keyword \d+: (.+)$/gm)].map((m) => m[1] as string);

/** A judge that answers every keyword in the batch according to `verdict`. */
const batchLlm = (
  verdict: (keyword: string) => { intentSuitable: boolean; localitySuitable: boolean } = () => ({
    intentSuitable: true,
    localitySuitable: true,
  }),
): LlmClient => ({
  complete: vi.fn(async ({ messages }: { messages: { content: string }[] }) =>
    reply(
      JSON.stringify({
        judgments: promptKeywords(messages.at(-1)?.content ?? '').map((keyword, index) => ({
          index,
          ...verdict(keyword),
          reason: null,
        })),
      }),
    ),
  ),
});

const okLlm = () => batchLlm();

it('rejects authority-dominated SERPs deterministically (no LLM call)', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['wikipedia.org', 'amazon.com', 'blogx.com', 'blogy.com'])),
  } as unknown as DataForSeoClient;
  const llm = okLlm();
  const { accepted, rejected } = await validateSerp([cand('k')], {
    dataForSeo,
    llm,
    presets,
    config,
  });
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
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com'])),
  } as unknown as DataForSeoClient;
  const llm = batchLlm(() => ({ intentSuitable: false, localitySuitable: true }));
  const { rejected } = await validateSerp([cand('k')], { dataForSeo, llm, presets, config });
  expect(rejected[0]!.rejection_reason).toBe('serp_intent');
});

it('fetches SERPs concurrently, but preserves order and dedup semantics', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const shared = serp(['a.com', 'b.com', 'c.com', 'd.com']);
  const dataForSeo = {
    // Distinct SERP per keyword except 'dup', which mirrors 'first' so it trips
    // the sequential duplicate check — proving Phase 2 stays ordered.
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return keyword === 'first' || keyword === 'dup' ? shared : serp([`${keyword}.com`]);
    }),
  } as unknown as DataForSeoClient;

  const cands = ['first', 'k2', 'k3', 'dup'].map(cand);
  const { accepted, rejected } = await validateSerp(cands, {
    dataForSeo,
    llm: okLlm(),
    presets,
    config,
  });

  expect(maxInFlight).toBeGreaterThan(1); // ran in parallel
  expect(accepted.map((c) => c.keyword)).toEqual(['first', 'k2', 'k3']);
  expect(rejected.map((c) => c.rejection_reason)).toEqual(['serp_duplicate']);
});

// ---- determinism ----
// The judge went from one call per keyword to one call per batch (#211). The
// duplicate-overlap check reads the SERPs accepted BEFORE it, so the decision
// walk has to stay in input order no matter how the batches are cut or what
// order they resolve in. This fixture is built to break a naive implementation:
// duplicates sit in a DIFFERENT batch from their anchor, and the batches
// deliberately resolve out of order.
const authoritySerp = serp(['wikipedia.org', 'amazon.com', 'blogx.com', 'blogy.com']);
const sharedSerp = serp(['a.com', 'b.com', 'c.com', 'd.com']);

/** 25 keywords — 3 batches at SERP_JUDGE_BATCH_SIZE=10, with the interesting ones spread across them. */
const fixtureKeywords = [
  'anchor', // batch 0 — accepted, becomes the duplicate anchor
  'badIntent',
  ...Array.from({ length: 6 }, (_, i) => `f${i}`),
  'authority', // gated before the LLM, so it shifts the batch boundaries
  'dupA', // batch 0 tail
  ...Array.from({ length: 7 }, (_, i) => `g${i}`), // batch 1
  'badLocality',
  'dupB', // batch 1 — same SERP as 'anchor' back in batch 0
  ...Array.from({ length: 6 }, (_, i) => `h${i}`), // batch 2
  'dupC',
];

const serpFor = (keyword: string): SerpResult[] => {
  if (keyword === 'authority') return authoritySerp;
  if (keyword === 'anchor' || keyword.startsWith('dup')) return sharedSerp;
  return serp([`${keyword}.com`, `${keyword}-2.com`]);
};

const verdictFor = (keyword: string) => ({
  intentSuitable: keyword !== 'badIntent',
  localitySuitable: keyword !== 'badLocality',
});

/**
 * The pre-batching decision loop, transcribed: one judgment per keyword, applied
 * in input order. This is the baseline the batched implementation must match
 * exactly, because the replay fixture is only a valid comparison if it does.
 */
function serialReference(keywords: string[]): { keyword: string; reason: string | null }[] {
  const acceptedUrls: Set<string>[] = [];
  const out: { keyword: string; reason: string | null }[] = [];
  for (const keyword of keywords) {
    const top = serpFor(keyword).slice(0, config.serpTopK);
    if (
      top.filter((r) => ['wikipedia.org', 'amazon.com'].includes(r.domain)).length / top.length >=
      config.authorityThreshold
    ) {
      out.push({ keyword, reason: 'serp_authority' });
      continue;
    }
    const urls = new Set(top.map((r) => r.url));
    const dup = acceptedUrls.some((prev) => {
      const inter = [...urls].filter((u) => prev.has(u)).length;
      return inter / (urls.size + prev.size - inter) >= config.duplicateSerpOverlap;
    });
    if (dup) {
      out.push({ keyword, reason: 'serp_duplicate' });
      continue;
    }
    const v = verdictFor(keyword);
    if (!v.intentSuitable) out.push({ keyword, reason: 'serp_intent' });
    else if (!v.localitySuitable) out.push({ keyword, reason: 'serp_locality' });
    else {
      acceptedUrls.push(urls);
      out.push({ keyword, reason: null });
    }
  }
  return out;
}

it('batched judgment returns exactly what one-call-per-keyword would', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let call = 0;
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) => serpFor(keyword)),
  } as unknown as DataForSeoClient;
  const llm: LlmClient = {
    complete: vi.fn(async ({ messages }: { messages: { content: string }[] }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const keywords = promptKeywords(messages.at(-1)?.content ?? '');
      // Later batches finish FIRST, so any reliance on completion order breaks.
      await new Promise((r) => setTimeout(r, Math.max(0, 30 - call++ * 10)));
      inFlight--;
      return reply(
        JSON.stringify({
          judgments: keywords.map((keyword, index) => ({
            index,
            ...verdictFor(keyword),
            reason: null,
          })),
        }),
      );
    }),
  } as unknown as LlmClient;

  const { accepted, rejected, coverage } = await validateSerp(fixtureKeywords.map(cand), {
    dataForSeo,
    llm,
    presets,
    config,
  });

  const expected = serialReference(fixtureKeywords);

  expect(maxInFlight).toBeGreaterThan(1);
  expect(accepted.map((c) => c.keyword)).toEqual(
    expected.filter((e) => e.reason === null).map((e) => e.keyword),
  );
  expect(rejected.map((c) => ({ keyword: c.keyword, reason: c.rejection_reason }))).toEqual(
    expected.filter((e) => e.reason !== null),
  );
  // The duplicates really did land in different batches from their anchor.
  expect(rejected.filter((c) => c.rejection_reason === 'serp_duplicate')).toHaveLength(3);
  // One call per batch of the 24 non-authority keywords, not one per keyword.
  const pending = fixtureKeywords.length - 1;
  expect((llm.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
    Math.ceil(pending / SERP_JUDGE_BATCH_SIZE),
  );
  expect(coverage).toEqual({
    sent: pending,
    returned: pending,
    unparseable: 0,
    batches: Math.ceil(pending / SERP_JUDGE_BATCH_SIZE),
    failedBatches: 0,
  });
});

// Batching raises the blast radius of one bad body from one keyword to N. It has
// to degrade per-keyword: the rest of the batch keeps its real verdicts, and the
// unjudged keyword takes the fail-open default (policy unchanged, now counted).
it('lets one malformed row fail open without touching the rest of its batch', async () => {
  const keywords = ['a', 'badIntent', 'c', 'd'];
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) =>
      serp([`${keyword}.com`, `${keyword}-2.com`]),
    ),
  } as unknown as DataForSeoClient;
  const llm: LlmClient = {
    complete: vi.fn(async ({ messages }: { messages: { content: string }[] }) =>
      reply(
        JSON.stringify({
          judgments: promptKeywords(messages.at(-1)?.content ?? '').map((keyword, index) =>
            // 'c' comes back unusable; everyone else is judged normally.
            keyword === 'c'
              ? { index, intentSuitable: 'maybe', localitySuitable: null }
              : { index, ...verdictFor(keyword), reason: null },
          ),
        }),
      ),
    ),
  } as unknown as LlmClient;

  const { accepted, rejected, coverage } = await validateSerp(keywords.map(cand), {
    dataForSeo,
    llm,
    presets,
    config,
  });

  // 'badIntent' is still rejected on its own verdict; 'c' fails open; 'a'/'d' unaffected.
  expect(accepted.map((c) => c.keyword)).toEqual(['a', 'c', 'd']);
  expect(rejected.map((c) => ({ keyword: c.keyword, reason: c.rejection_reason }))).toEqual([
    { keyword: 'badIntent', reason: 'serp_intent' },
  ]);
  expect(coverage.unparseable).toBe(1);
  expect(coverage.returned).toBe(3);
  expect(coverage.failedBatches).toBe(0);
});

// The production failure mode, at batch scale: the model burns its output budget
// and returns "". Every keyword in that batch is accepted unjudged — allowed by
// the fail-open policy, but it must be counted rather than silent.
it('counts a dead batch body instead of failing it open silently', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) =>
      serp([`${keyword}.com`, `${keyword}-2.com`]),
    ),
  } as unknown as DataForSeoClient;
  const llm: LlmClient = { complete: vi.fn(async () => reply('')) };

  const { accepted, coverage } = await validateSerp(['a', 'badIntent'].map(cand), {
    dataForSeo,
    llm,
    presets,
    config,
  });

  expect(accepted).toHaveLength(2);
  expect(coverage).toEqual({
    sent: 2,
    returned: 0,
    unparseable: 2,
    batches: 1,
    failedBatches: 1,
  });
});

it('accepts a clean SERP', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com'])),
  } as unknown as DataForSeoClient;
  const { accepted } = await validateSerp([cand('k')], {
    dataForSeo,
    llm: okLlm(),
    presets,
    config,
  });
  expect(accepted).toHaveLength(1);
});
