/**
 * Proving a link target is live (#186). This is deliberately the ONLY thing we
 * trust: we never ask a publishing plugin what URL it created, so WordPress,
 * the Vue static-site adapter, and every future adapter are all held to the
 * same test — does this URL answer 2xx right now?
 */
import type { LinkCandidate } from './links';

const VERIFY_TIMEOUT_MS = 5_000;
const VERIFY_CONCURRENCY = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; SeoPotionLinkCheck/1.0; +https://seopotion.co/bot)';

/**
 * One URL, HEAD first (cheap) with a GET retry. GET is the authority: any
 * non-2xx HEAD response — method rejected, or a WAF/CDN blocking HEAD outright
 * (more likely given the identifying User-Agent below) — falls through to GET
 * rather than trusting the HEAD status. A URL is only ever "live" via `res.ok`,
 * so this cannot introduce a false positive, only avoid a false negative.
 */
async function isLive(url: string): Promise<boolean> {
  for (const method of ['HEAD', 'GET'] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (res.ok) return true;
      if (method === 'HEAD') continue;
      return false;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

/** Candidates whose URL is live. Anything unproven is dropped, never guessed. */
export async function verifyCandidates(candidates: LinkCandidate[]): Promise<LinkCandidate[]> {
  const live: LinkCandidate[] = [];
  for (let i = 0; i < candidates.length; i += VERIFY_CONCURRENCY) {
    const chunk = candidates.slice(i, i + VERIFY_CONCURRENCY);
    const checked = await Promise.all(chunk.map(async (c) => ((await isLive(c.url)) ? c : null)));
    live.push(...checked.filter((c): c is LinkCandidate => c !== null));
  }
  return live;
}
