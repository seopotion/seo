import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Module-scoped for Lambda warm reuse, matching the SQS client in queue.ts.
const s3 = new S3Client({});

/**
 * One year, immutable. These URLs are committed verbatim into client repos
 * (#177), so a repeat visitor should never revalidate; without it CloudFront
 * falls back to its default TTL (#178). `immutable` is only truthful because
 * the key is content-addressed — see `storeImage`.
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * 64 bits of SHA-256. Enough to make a collision unreachable at this scale
 * (a few objects per article), and short enough that the URL still reads as a
 * URL in the `git diff` these land in.
 */
const DIGEST_CHARS = 16;

/**
 * Upload image bytes to the per-stage images bucket; returns the public
 * CloudFront URL. Returns null when IMAGES_BUCKET is unset — local dev
 * fallback so the pipeline runs without AWS credentials (#51).
 *
 * The key is `{keyBase}-{sha256(bytes)}.{ext}`, digested from the exact bytes
 * being uploaded. A slot key alone is not safe to serve `immutable`: the S3 put
 * happens *before* the guarded `fillImageSlot`, so two concurrent deliveries for
 * one slot both write, last-put-wins, and the delivery that wins the database
 * guard can end up describing bytes the loser overwrote — persisting dimensions
 * that do not match the object, cached for a year. Content-addressing makes each
 * distinct image its own object, so a URL's bytes can never change under it.
 */
export async function storeImage(
  keyBase: string,
  bytes: Uint8Array,
  contentType: string,
  ext: string,
): Promise<string | null> {
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, DIGEST_CHARS);
  const key = `${keyBase}-${digest}.${ext}`;
  const bucket = process.env.IMAGES_BUCKET;
  if (!bucket) return null;
  const domain = process.env.IMAGES_CDN_DOMAIN;
  if (!domain) throw new Error('IMAGES_CDN_DOMAIN is required when IMAGES_BUCKET is set');
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: CACHE_CONTROL,
    }),
  );
  return `https://${domain}/${key}`;
}
