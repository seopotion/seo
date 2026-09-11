import {
  MAX_MANUAL_IMAGE_BYTES,
  MAX_MANUAL_IMAGE_EDGE,
  MAX_MANUAL_IMAGE_SOURCE_BYTES,
} from '@shared/schemas';
import { ApiError } from './api';

export async function optimizeImage(file: File) {
  if (
    !['image/webp', 'image/jpeg', 'image/png'].includes(file.type) ||
    file.size === 0 ||
    file.size > MAX_MANUAL_IMAGE_SOURCE_BYTES
  ) {
    throw new ApiError('invalid_image_source', 0);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ApiError('image_decode_failed', 0);
  }
  const canvas = document.createElement('canvas');
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new ApiError('image_decode_failed', 0);
    }
    const context = canvas.getContext('2d');
    if (!context) throw new ApiError('image_optimization_failed', 0);
    const sourceEdge = Math.max(bitmap.width, bitmap.height);
    let edge = Math.min(sourceEdge, MAX_MANUAL_IMAGE_EDGE);
    const minimumEdge = Math.min(edge, 320);
    while (true) {
      const scale = edge / sourceEdge;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.75, 0.65, 0.55]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', quality),
        );
        if (!blob || blob.size === 0) throw new ApiError('image_optimization_failed', 0);
        if (blob.type !== 'image/webp') throw new ApiError('image_webp_unsupported', 0);
        if (blob.size <= MAX_MANUAL_IMAGE_BYTES) {
          return {
            file: new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {
              type: blob.type,
            }),
            width: canvas.width,
            height: canvas.height,
          };
        }
      }
      if (edge === minimumEdge) throw new ApiError('image_compression_limit', 0);
      edge = Math.max(minimumEdge, Math.floor(edge * 0.8));
    }
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
