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
