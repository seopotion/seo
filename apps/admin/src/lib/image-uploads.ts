import { MAX_MANUAL_IMAGE_BYTES } from '@shared/schemas';
import type { InferRequestType } from 'hono/client';
import { ApiError, adminApi, unwrap } from './api';

export type ImageUploadMetadata = InferRequestType<
  (typeof adminApi.admin.v0.articles)[':article_id']['images']['upload']['$post']
>['json'];

export async function prepareImageUpload(articleId: string, metadata: ImageUploadMetadata) {
  return unwrap(
    await adminApi.admin.v0.articles[':article_id'].images.upload.$post({
      param: { article_id: articleId },
      json: metadata,
    }),
  );
}

export async function finalizeImageUpload(articleId: string, token: string) {
  return unwrap(
    await adminApi.admin.v0.articles[':article_id'].images.finalize.$post({
      param: { article_id: articleId },
      json: { upload_token: token },
    }),
  );
}

export async function removeArticleImage(articleId: string, url: string) {
  return unwrap(
    await adminApi.admin.v0.articles[':article_id'].images.remove.$post({
      param: { article_id: articleId },
      json: { url },
    }),
  );
}

export function uploadImageFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  if (file.size === 0 || file.size > MAX_MANUAL_IMAGE_BYTES) {
    return Promise.reject(new ApiError('image_compression_limit', 0));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError('image_upload_failed', xhr.status));
    xhr.onerror = () => reject(new ApiError('image_upload_network_error', 0));
    xhr.ontimeout = () => reject(new ApiError('image_upload_timeout', 0));
    xhr.onabort = () => reject(new ApiError('image_upload_cancelled', 0));
    xhr.timeout = 120_000;
    xhr.send(file);
  });
}
