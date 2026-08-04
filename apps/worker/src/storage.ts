import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Module-scoped for Lambda warm reuse, matching the SQS client in queue.ts.
const s3 = new S3Client({});

/**
 * One year, immutable. Safe because `slotKey` is deterministic per article slot
 * and a regenerate overwrites the same key with the same subject — and required,
 * because these URLs are committed verbatim into client repos (#177), so repeat
 * visitors should never revalidate. Without it CloudFront falls back to its
 * default TTL (#178).
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Upload image bytes to the per-stage images bucket; returns the public
 * CloudFront URL. Returns null when IMAGES_BUCKET is unset — local dev
 * fallback so the pipeline runs without AWS credentials (#51).
 */
export async function storeImage(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
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
