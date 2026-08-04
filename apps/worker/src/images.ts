import { ArticleRepo, OrgRepo } from '@shared/db';
import {
  buildImagePlanPrompt,
  extractH2s,
  injectImageAfterHeading,
  parseImagePlan,
} from '@shared/generation';
import { type ArticleImage, ImageTask } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getImageClients } from './providers';
import { storeImage } from './storage';

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
 * Stored content-type -> key extension. fal is asked for WebP (`outputFormat`
 * below), so 'webp' is the expected path; the map keeps the key honest rather
 * than mislabelling the bytes if the provider ever answers with something else.
 */
const EXT_BY_TYPE: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Deterministic S3 key per slot — retries overwrite, never duplicate (#51). */
function slotKey(articleId: string, role: ArticleImage['role'], index: number, ext: string) {
  return `articles/${articleId}/${role === 'cover' ? 'cover' : `inline-${index}`}.${ext}`;
}

/**
 * Images worker — triggered by SQS (enqueued by the generation worker after an
 * article persists). Plans cover + inline images once (set-if-absent), then
 * fills unfinished slots idempotently: generate via fal -> store in S3 behind
 * CloudFront -> record URL (+ inject inline markdown after its H2). All slots
 * filled => images_status 'complete' + featured_image_url. Provider errors
 * rethrow so SQS redelivers and the loop resumes at the first unfinished slot
 * (-> DLQ after 3). See design/article-images.md & #51.
 */
export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let articleId: string | undefined;
    try {
      const task = ImageTask.parse(JSON.parse(record.body));
      articleId = task.article_id;
      logger.appendKeys({ org_id: task.org_id, article_id: articleId });

      let article = await ArticleRepo.findById(articleId);
      if (!article) {
        logger.warn('images skipped: article missing');
        continue;
      }
      if (article.images_status === 'complete') {
        logger.info('images skipped: already complete');
        continue;
      }

      const { llm, image } = getImageClients();

      // Plan once (set-if-absent): a redelivery never re-plans or reshuffles slots.
      if (article.images.length === 0) {
        const org = await OrgRepo.findById(task.org_id);
        if (!org?.presets) {
          logger.warn('images skipped: org or presets missing');
          continue;
        }
        const headings = extractH2s(article.content);
        const res = await llm.complete({
          messages: buildImagePlanPrompt({
            businessName: org.presets.business.name,
            businessDescription: org.presets.business.description,
            language: org.presets.business.language,
            imageStyle: org.presets.article_preferences.engagement.image_style,
            articleTitle: article.title,
            metaDescription: article.meta_description,
            headings,
          }),
          responseFormat: 'json',
        });
        let plan: ReturnType<typeof parseImagePlan>;
        try {
          plan = parseImagePlan(res.text, headings);
        } catch (err) {
          // Bad plan: mark failed (ops-visible) and rethrow; a redelivery re-plans.
          await ArticleRepo.failImages(articleId).catch(() => {});
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
        await ArticleRepo.setImagePlan(articleId, slots); // false = raced; reload below
        article = await ArticleRepo.findById(articleId);
        if (!article) continue;
      }

      // Fill unfinished slots; finished ones are skipped (idempotent resume).
      let content = article.content;
      for (const [i, slot] of article.images.entries()) {
        if (slot.url !== '') continue;
        const res = await image.generate({
          prompt: slot.prompt,
          model: IMAGE_MODEL,
          size: SLOT_SIZE[slot.role],
          // fal encodes WebP itself, so no PNG is ever downloaded, stored or
          // published — and the object we fetch is ~70KB rather than ~1.1MB (#178).
          outputFormat: 'webp',
        });
        const generated = res.images[0];
        if (!generated?.url) throw new Error('image provider returned no image');
        const src = generated.url;

        const imgRes = await fetch(src);
        if (!imgRes.ok) throw new Error(`image download failed (${imgRes.status})`);
        const contentType = imgRes.headers.get('content-type') ?? 'image/webp';
        const ext = EXT_BY_TYPE[contentType] ?? 'webp';
        const bytes = new Uint8Array(await imgRes.arrayBuffer());

        const stored = await storeImage(slotKey(articleId, slot.role, i, ext), bytes, contentType);
        if (!stored) logger.warn('IMAGES_BUCKET unset: storing provider URL (local dev only)');
        const url = stored ?? src;
        // The byte budget is the acceptance criterion and fal picks the quality —
        // so log what we actually stored, per slot, to keep it measurable in prod.
        logger.info('image stored', {
          role: slot.role,
          content_type: contentType,
          bytes: bytes.byteLength,
          width: generated.width,
          height: generated.height,
        });

        const newContent =
          slot.role === 'inline' && slot.section_heading
            ? injectImageAfterHeading(content, slot.section_heading, slot.alt, url)
            : null;
        await ArticleRepo.fillImageSlot(
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
        if (newContent) content = newContent;
        slot.url = url; // local view for the completion step below
      }

      const cover = article.images.find((s) => s.role === 'cover');
      if (!cover?.url) throw new Error('cover slot missing after fill');
      await ArticleRepo.completeImages(articleId, cover.url);
      logger.info('article images complete');
    } catch (err) {
      // Rethrow so SQS redelivers (finished slots are skipped on resume; -> DLQ after 3).
      logger.error('image generation failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id', 'article_id']);
    }
  }
};
