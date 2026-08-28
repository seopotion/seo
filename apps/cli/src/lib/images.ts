/**
 * One-off repair for articles whose image URLs point at a CloudFront
 * distribution that no longer exists — the pre-2026-08-12 account move left
 * `images[].url` / `featured_image_url` / the inline markdown holding absolute
 * URLs into a deleted CDN (infra/ENVIRONMENTS.md § Legacy account). Those bytes
 * are gone, so the only fix is to re-arm the slots and regenerate.
 *
 * Blanking is the whole job: the image worker skips filled slots and
 * short-circuits on `images_status: 'complete'`, so a replayed task does
 * nothing until the dead slots read as unfilled again.
 *
 * Dry run by default. `--enqueue` (with `--apply`) launches an image-repair
 * run for each reset article; without it the command only reports the ids to
 * replay.
 */
import { launchImageRepair } from '@shared/articles';
import { ArticleRepo, closeDb } from '@shared/db';
import type { Article, ArticleImage } from '@shared/schemas';
import { fail, ok, type ResetImagesData, type Result } from '../types';

const MAX_ARTICLES = 500;

/** The empty-slot shape the worker's plan step writes, minus the planned fields. */
const EMPTY_SLOT = {
  url: '',
  model: null,
  seed: null,
  generated_at: null,
  width: null,
  height: null,
} satisfies Partial<ArticleImage>;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Drop the `![alt](url)` line the worker injected after an H2, plus the blank
 * line it inserted with it — matching on the URL, since the editor may have
 * changed the alt text since. Leaves the body untouched when the line is gone
 * already (hand-edited article).
 */
export function stripImageMarkdown(content: string, url: string): string {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`^!\\[[^\\]]*\\]\\(${escaped}\\)\\s*$`);
  const lines = content.split('\n');
  const out: string[] = [];
  for (const [i, current] of lines.entries()) {
    if (!line.test(current)) {
      out.push(current);
      continue;
    }
    // The injection was ['', '![…](…)'] after the heading, so the blank line
    // before the image is ours and the one after it is the body's — dropping
    // the image alone would leave the pair behind.
    if (out.at(-1)?.trim() === '' && lines[i + 1]?.trim() === '') out.pop();
  }
  return out.join('\n');
}

/** The reset for one article, or null when no slot references the dead host. */
export function planReset(
  article: Article,
  host: string,
): { images: ArticleImage[]; content: string; featuredImageUrl: string; slots: number } | null {
  const dead = (url: string) => url !== '' && hostOf(url) === host;

  let content = article.content;
  let slots = 0;
  const images = article.images.map((slot) => {
    if (!dead(slot.url)) return slot;
    slots += 1;
    if (slot.role === 'inline') content = stripImageMarkdown(content, slot.url);
    return { ...slot, ...EMPTY_SLOT };
  });

  const featuredDead = dead(article.featured_image_url);
  if (slots === 0 && !featuredDead) return null;

  return {
    images,
    content,
    featuredImageUrl: featuredDead ? '' : article.featured_image_url,
    slots,
  };
}

export async function resetImages(opts: {
  org?: string;
  article?: string;
  host?: string;
  apply: boolean;
  enqueue: boolean;
}): Promise<Result<ResetImagesData>> {
  if (!opts.host) {
    return fail(
      'HOST_REQUIRED',
      'Pass --host <cdn-domain> — the dead CDN whose URLs should be reset.',
      'The build error names it, e.g. --host detl6k0jbfi2q.cloudfront.net',
    );
  }
  if (!opts.org && !opts.article) {
    return fail('TARGET_REQUIRED', 'Pass --org <id> or --article <id>.');
  }
  if (opts.enqueue && !opts.apply) {
    return fail('ENQUEUE_NEEDS_APPLY', 'Add --apply: there is nothing to regenerate on a dry run.');
  }

  const host = opts.host.toLowerCase();
  try {
    let articles: Article[];
    if (opts.article) {
      const article = await ArticleRepo.findById(opts.article);
      if (!article) return fail('ARTICLE_NOT_FOUND', `No article with id ${opts.article}.`);
      articles = [article];
    } else {
      articles = (
        await ArticleRepo.listByOrg(opts.org as string, { limit: MAX_ARTICLES, offset: 0 })
      ).articles;
    }

    const reset: ResetImagesData['reset'] = [];
    let slotsReset = 0;
    let enqueued = 0;

    for (const article of articles) {
      const plan = planReset(article, host);
      if (!plan) continue;
      slotsReset += plan.slots;
      reset.push({
        id: article.id,
        title: article.title,
        status: article.status,
        slots: plan.slots,
      });
      if (!opts.apply) continue;
      await ArticleRepo.resetImages(article.id, plan);
      if (opts.enqueue) {
        // wait: true — this CLI command closes the shared Mongo connection and
        // exits right after resetImages returns, which would otherwise race
        // launchImageRepair's fire-and-forget local run (see apps/cli/src/lib/
        // db.ts's launchStrategy call for the same fix).
        await launchImageRepair(article.org_id, article.id, { wait: true });
        enqueued += 1;
      }
    }

    return ok({
      apply: opts.apply,
      host,
      scanned: articles.length,
      slotsReset,
      enqueued,
      reset,
    });
  } catch (e) {
    return fail('RESET_IMAGES_FAILED', (e as Error).message);
  } finally {
    await closeDb();
  }
}
