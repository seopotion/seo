import { ArticleRepo } from '@shared/db';
import {
  buildImagePlanPrompt,
  extractH2s,
  IMAGE_PLAN_RESPONSE_SCHEMA,
  injectImageAfterHeading,
  parseImagePlan,
  withNoTextDirective,
} from '@shared/generation';
import type { ImageResult, LlmClient } from '@shared/providers';
import type { ArticleImage, ArticleRun } from '@shared/schemas';
import type { ArticleStageClients } from '../clients';
import { ArticleFatalError, ArticleRetryableError } from '../errors';
import { storeImage } from '../storage';
import type { StageOutcome } from './types';

/** Recorded on each slot; passed explicitly to generate so metadata stays truthful. */
const IMAGE_MODEL = 'fal-ai/flux-2';

/**
 * Exact pixels per role. The cover is the OG large-card size; inline is the same
 * 1200px cap at 16:9. Asking for exact dimensions (rather than a named preset)
 * is what keeps inline images from arriving wider than the cap — fal still snaps
 * to model-friendly multiples, which is why the *returned* size is what we store.
 */
const SLOT_SIZE = {
  cover: { width: 1200, height: 630 },
  inline: { width: 1200, height: 675 },
} as const;

/**
 * Byte budget per slot (#178), raised from 150/100KB once real generations showed
 * fal's WebP only lands there for illustration styles — photographic subjects run
 * 1.6-3.7x higher and fal exposes no quality knob to turn down. Over-cap is warned,
 * never fatal: a heavy cover is worse than no cover, and this is the only signal
 * that would show the measured tail (~555KB) actually happening in production.
 */
const SLOT_BYTE_CAP = { cover: 250 * 1024, inline: 200 * 1024 } as const;

/**
 * Stored content-type -> key extension. fal is asked for WebP (`outputFormat`
 * below), so 'webp' is the expected path; the map keeps the key honest rather
 * than mislabelling the bytes if the provider ever answers with something else.
 */
const EXT_BY_TYPE: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Key prefix per slot; `storeImage` appends the content digest + extension. */
function slotKeyBase(articleId: string, role: ArticleImage['role'], index: number) {
  return `articles/${articleId}/${role === 'cover' ? 'cover' : `inline-${index}`}`;
}

type GeneratedImage = ImageResult['images'][number];

const isPositivePixels = (n: number | null): boolean => n !== null && Number.isInteger(n) && n > 0;

/**
 * Dimensions are published as `<img width height>` to stop CLS (#176), so a
 * bad value is worse than none: it would reserve the wrong box on a client's
 * page. Throwing here means nothing is uploaded or persisted and the stage rethrows.
 */
function assertImageDimensions(
  image: GeneratedImage,
): asserts image is GeneratedImage & { width: number; height: number } {
  if (!isPositivePixels(image.width)) {
    throw new Error(`image provider returned an invalid width (${image.width})`);
  }
  if (!isPositivePixels(image.height)) {
    throw new Error(`image provider returned an invalid height (${image.height})`);
  }
}

async function resolveArticle(run: ArticleRun) {
  const articleId = run.working.article_id;
  if (!articleId) throw new ArticleFatalError('images stage requires a checkpointed article_id');
  const article = await ArticleRepo.findById(articleId);
  if (!article) throw new ArticleFatalError(`images stage: article ${articleId} not found`);
  return article;
}

/**
 * Plans cover + inline images once (set-if-absent): a redrive never re-plans or
 * reshuffles slots. Ports apps/worker/src/images.ts:147-203 onto a checkpointed
 * run, with org presets read from the run's launch snapshot instead of a fresh
 * OrgRepo fetch. See the 2026-08-28 design spec.
 */
export async function stageImagesPlan(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const article = await resolveArticle(run);
  if (article.images.length > 0) return { completed: true, working: {} };

  const presets = run.input.presets;
  const headings = extractH2s(article.content);
  const res = await llm.complete({
    messages: buildImagePlanPrompt({
      businessName: presets.business.name,
      businessDescription: presets.business.description,
      language: presets.business.language,
      imageStyle: presets.article_preferences.engagement.image_style,
      articleTitle: article.title,
      metaDescription: article.meta_description,
      headings,
    }),
    responseSchema: IMAGE_PLAN_RESPONSE_SCHEMA,
  });
  let plan: ReturnType<typeof parseImagePlan>;
  try {
    plan = parseImagePlan(res.text, headings);
  } catch (err) {
    // Bad plan: mark failed (ops-visible) and rethrow; a redrive re-plans.
    await ArticleRepo.failImages(article.id).catch(() => {});
    throw err;
  }
  const empty = {
    url: '',
    model: null,
    seed: null,
    generated_at: null,
    width: null,
    height: null,
  };
  const slots: ArticleImage[] = [
    { role: 'cover', section_heading: null, ...plan.cover, ...empty },
    ...plan.inline.map((img): ArticleImage => ({ role: 'inline', ...img, ...empty })),
  ];
  await ArticleRepo.setImagePlan(article.id, slots); // false = raced; the next stage reloads

  return { completed: true, working: {} };
}

/**
 * Fills unfinished slots idempotently: generate via fal -> store in S3 behind
 * CloudFront -> record URL (+ inject inline markdown after its H2). All slots
 * filled => images_status 'complete' + featured_image_url. Provider errors
 * rethrow so the stage retries and the loop resumes at the first unfinished
 * slot. Ports apps/worker/src/images.ts:205-291. See design/article-images.md & #51.
 */
export async function stageImagesRender(
  run: ArticleRun,
  image: ArticleStageClients['image'],
): Promise<StageOutcome> {
  const article = await resolveArticle(run);
  if (article.images_status === 'complete') return { completed: true, working: {} };
  if (article.images.length === 0) throw new ArticleRetryableError('image plan missing');

  const articleId = article.id;
  let content = article.content;
  for (const [i, slot] of article.images.entries()) {
    if (slot.url !== '') continue;
    const res = await image.generate({
      // The planner is told to avoid lettering, but flux-2 still renders
      // garbled words on any surface that implies them — so the ban is
      // restated here, which also covers slots planned before that rule.
      prompt: withNoTextDirective(slot.prompt),
      model: IMAGE_MODEL,
      size: SLOT_SIZE[slot.role],
      // fal encodes WebP itself, so no PNG is ever downloaded, stored or
      // published. Measured 63KB-555KB depending on subject detail, against
      // ~2MB as PNG; fal has no quality knob, so the spread is not ours to
      // narrow — see design/article-images.md § Measured (#178).
      outputFormat: 'webp',
    });
    const generated = res.images[0];
    if (!generated?.url) throw new Error('image provider returned no image');
    assertImageDimensions(generated);
    const src = generated.url;

    const imgRes = await fetch(src);
    if (!imgRes.ok) throw new Error(`image download failed (${imgRes.status})`);
    const contentType = imgRes.headers.get('content-type') ?? 'image/webp';
    const ext = EXT_BY_TYPE[contentType] ?? 'webp';
    const bytes = new Uint8Array(await imgRes.arrayBuffer());

    const stored = await storeImage(slotKeyBase(articleId, slot.role, i), bytes, contentType, ext);
    if (!stored) console.warn('IMAGES_BUCKET unset: storing provider URL (local dev only)');
    const url = stored ?? src;
    // The byte budget is the acceptance criterion and fal picks the quality —
    // so log what we actually stored, per slot, to keep it measurable in prod.
    const overCap = bytes.byteLength > SLOT_BYTE_CAP[slot.role];
    const stats = {
      role: slot.role,
      content_type: contentType,
      bytes: bytes.byteLength,
      cap: SLOT_BYTE_CAP[slot.role],
      width: generated.width,
      height: generated.height,
    };
    if (overCap) console.warn('image stored over byte cap', stats);
    else console.info('image stored', stats);

    const newContent =
      slot.role === 'inline' && slot.section_heading
        ? injectImageAfterHeading(content, slot.section_heading, slot.alt, url)
        : null;
    const won = await ArticleRepo.fillImageSlot(
      articleId,
      i,
      {
        url,
        model: IMAGE_MODEL,
        seed: res.seed,
        generated_at: new Date(),
        width: generated.width,
        height: generated.height,
      },
      newContent,
    );
    if (won) {
      if (newContent) content = newContent;
      continue;
    }
    // A concurrent delivery filled this slot first. Its image and its
    // markdown injection are the persisted truth, so adopt them — carrying
    // our own `url` forward would publish a URL the article never recorded
    // and inject a second copy of the image into the next slot's content.
    const persisted = await ArticleRepo.findById(articleId);
    const winner = persisted?.images[i];
    if (!persisted || !winner?.url) {
      throw new Error(`image slot ${i} unfilled after losing the fill race`);
    }
    content = persisted.content;
  }

  // Reload rather than trusting the local view: any slot in this pass may
  // have been won by a concurrent delivery, so the database holds the URLs
  // and dimensions that were actually published.
  const filled = await ArticleRepo.findById(articleId);
  const cover = filled?.images.find((s) => s.role === 'cover');
  if (!cover?.url) throw new Error('cover slot missing after fill');
  await ArticleRepo.completeImages(articleId, cover.url);

  return { completed: true, working: {} };
}
