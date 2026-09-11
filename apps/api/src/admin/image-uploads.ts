import { createHmac, randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ArticleRepo } from '@shared/db';
import { injectImageAfterHeading } from '@shared/generation';
import {
  type Article,
  type ArticleImage,
  MAX_MANUAL_ARTICLE_IMAGES,
  MAX_MANUAL_IMAGE_BYTES,
  MAX_MANUAL_IMAGE_EDGE,
} from '@shared/schemas';
import { sign, verify } from 'hono/jwt';
import { imageSize } from 'image-size';
import { z } from 'zod';
import { AdminImageUploadBody, imageHeadings } from './schemas';
import { getAdminJwtSecret } from './secret';

const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
const extensions = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
const cacheControl = 'public, max-age=31536000, immutable';
const UploadClaims = AdminImageUploadBody.extend({
  article_id: z.string(),
  org_id: z.string(),
  operator: z.string(),
  bucket: z.string(),
  domain: z.string(),
  key: z.string(),
  previous_url: z.string().nullable(),
  exp: z.number(),
});

export class ImageUploadError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 409 | 503 = 400,
  ) {
    super(code);
  }
}

function storage() {
  const bucket = process.env.IMAGES_BUCKET;
  const domain = process.env.IMAGES_CDN_DOMAIN;
  if (!bucket || !domain) throw new ImageUploadError('image_storage_unavailable', 503);
  return { bucket, domain };
}

async function tokenSecret() {
  return createHmac('sha256', await getAdminJwtSecret())
    .update('manual-image-upload-v1')
    .digest('hex');
}

function currentSlot(article: Article, body: AdminImageUploadBody) {
  return article.images.find(
    (image) =>
      image.role === body.role &&
      (body.role === 'cover' || image.section_heading === body.section_heading),
  );
}

function validatePlacement(article: Article, body: AdminImageUploadBody) {
  if (!currentSlot(article, body) && article.images.length >= MAX_MANUAL_ARTICLE_IMAGES) {
    throw new ImageUploadError('manual_image_limit', 409);
  }
  if (body.role === 'cover') {
    if (body.section_heading !== null) throw new ImageUploadError('invalid_image_placement');
  } else {
    if (!body.section_heading || !imageHeadings(article.content).includes(body.section_heading)) {
      throw new ImageUploadError('invalid_image_placement');
    }
  }
}

export async function prepareImageUpload(
  article: Article,
  operator: string,
  body: AdminImageUploadBody,
) {
  validatePlacement(article, body);
  const { bucket, domain } = storage();
  const key = `articles/${article.id}/manual-${randomUUID()}.${extensions[body.content_type]}`;
  const headers = {
    'Content-Type': body.content_type,
    'Cache-Control': cacheControl,
    'If-None-Match': '*',
  };
  const upload_url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: body.content_type,
      ContentLength: body.size,
      CacheControl: cacheControl,
      IfNoneMatch: '*',
    }),
    {
      expiresIn: 300,
      signableHeaders: new Set([
        'content-type',
        'content-length',
        'cache-control',
        'if-none-match',
      ]),
    },
  );
  const upload_token = await sign(
    {
      ...body,
      article_id: article.id,
      org_id: article.org_id,
      operator,
      bucket,
      domain,
      key,
      previous_url: currentSlot(article, body)?.url ?? null,
      exp: Math.floor(Date.now() / 1000) + 900,
    },
    await tokenSecret(),
    'HS256',
  );
  return { upload_url, headers, upload_token };
}

export function escapeImageAlt(alt: string) {
  return alt.replace(/[\\`*_[\]<>]/g, '\\$&');
}

export async function removeArticleImage(article: Article, url: string) {
  if (!article.images.some((image) => image.url === url)) return article;
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const content = article.content.replace(
    new RegExp(`!\\[(?:\\\\.|[^\\[\\]\\\\\\r\\n])*\\]\\(${escapedUrl}\\)`, 'g'),
    '',
  );
  const updated = await ArticleRepo.saveManualImage(
    article,
    article.images.filter((image) => image.url !== url),
    content,
    article.featured_image_url === url ? '' : article.featured_image_url,
  );
  if (!updated) throw new ImageUploadError('article_changed', 409);
  return updated;
}

export async function finalizeImageUpload(article: Article, operator: string, token: string) {
  let claims: z.infer<typeof UploadClaims>;
  try {
    claims = UploadClaims.parse(await verify(token, await tokenSecret(), 'HS256'));
  } catch {
    throw new ImageUploadError('invalid_upload_token');
  }
  const { bucket, domain } = storage();
  if (
    claims.article_id !== article.id ||
    claims.org_id !== article.org_id ||
    claims.operator !== operator ||
    claims.bucket !== bucket ||
    claims.domain !== domain ||
    !claims.key.startsWith(`articles/${article.id}/manual-`)
  ) {
    throw new ImageUploadError('invalid_upload_token');
  }
  const url = `https://${domain}/${claims.key}`;
  if (article.images.some((image) => image.url === url)) return article;
  validatePlacement(article, claims);
  const previous = currentSlot(article, claims);
  if ((previous?.url ?? null) !== claims.previous_url)
    throw new ImageUploadError('image_slot_changed', 409);

  let object: GetObjectCommandOutput;
  try {
    object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: claims.key }));
  } catch (error) {
    if (error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'AccessDenied')) {
      throw new ImageUploadError('upload_not_found');
    }
    throw error;
  }
  if (
    object.ContentLength !== claims.size ||
    object.ContentLength > MAX_MANUAL_IMAGE_BYTES ||
    object.ContentType !== claims.content_type ||
    !object.Body
  ) {
    if (object.Body && 'destroy' in object.Body) object.Body.destroy();
    throw new ImageUploadError('uploaded_file_mismatch');
  }
  const bytes = await object.Body.transformToByteArray();
  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw new ImageUploadError('invalid_image_file');
  }
  if (
    bytes.length !== claims.size ||
    bytes.length > MAX_MANUAL_IMAGE_BYTES ||
    dimensions.type !== extensions[claims.content_type] ||
    !dimensions.width ||
    !dimensions.height ||
    Math.max(dimensions.width, dimensions.height) > MAX_MANUAL_IMAGE_EDGE
  ) {
    throw new ImageUploadError('invalid_image_file');
  }
  const image: ArticleImage = {
    role: claims.role,
    section_heading: claims.section_heading,
    alt: claims.alt,
    url,
    prompt: '',
    model: null,
    seed: null,
    generated_at: null,
    width: dimensions.width,
    height: dimensions.height,
  };
  const images = previous
    ? article.images.map((slot) => (slot === previous ? image : slot))
    : [...article.images, image];
  let content = article.content;
  if (claims.role === 'inline' && claims.section_heading) {
    if (previous) {
      content = content.replace(`![${escapeImageAlt(previous.alt)}](${previous.url})`, '');
    }
    content = injectImageAfterHeading(
      content,
      claims.section_heading,
      escapeImageAlt(claims.alt),
      url,
    );
  }
  const updated = await ArticleRepo.saveManualImage(
    article,
    images,
    content,
    claims.role === 'cover' ? url : article.featured_image_url,
  );
  if (!updated) throw new ImageUploadError('article_changed', 409);
  return updated;
}
