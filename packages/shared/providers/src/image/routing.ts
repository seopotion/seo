import type { ImageMedium } from '@shared/schemas';

/** What every image got before routing existed. */
export const DEFAULT_IMAGE_MODEL = 'fal-ai/flux-2';
/**
 * Gemini's image model on fal: the one that renders the labels a diagram is
 * made of legibly. flux-2 letters garbage on anything that implies text.
 */
export const DIAGRAM_IMAGE_MODEL = 'fal-ai/nano-banana-pro';

export interface ImageRoute {
  /** fal model id. */
  model: string;
  /** flux-2 takes exact pixels (`image_size`); nano-banana takes an `aspect_ratio` enum. */
  sizing: 'pixels' | 'aspect_ratio';
}

/** The org's medium is the only image-routing signal (design/ai-model-routing.md). */
export function routeImage(medium: ImageMedium): ImageRoute {
  return medium === 'diagram'
    ? { model: DIAGRAM_IMAGE_MODEL, sizing: 'aspect_ratio' }
    : { model: DEFAULT_IMAGE_MODEL, sizing: 'pixels' };
}
