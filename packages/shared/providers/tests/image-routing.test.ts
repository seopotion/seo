import { IMAGE_MEDIA } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { DEFAULT_IMAGE_MODEL, DIAGRAM_IMAGE_MODEL, routeImage } from '../src/image/routing';

describe('routeImage', () => {
  // The medium is the only image-routing signal; content_complexity never is.
  test('diagram goes to the text-capable model, sized by aspect ratio', () => {
    expect(routeImage('diagram')).toEqual({ model: DIAGRAM_IMAGE_MODEL, sizing: 'aspect_ratio' });
    expect(DIAGRAM_IMAGE_MODEL).toBe('fal-ai/nano-banana-pro');
  });

  test('every other medium keeps flux-2 with exact pixels', () => {
    for (const medium of IMAGE_MEDIA.filter((m) => m !== 'diagram')) {
      expect(routeImage(medium)).toEqual({ model: DEFAULT_IMAGE_MODEL, sizing: 'pixels' });
    }
    expect(DEFAULT_IMAGE_MODEL).toBe('fal-ai/flux-2');
  });
});
