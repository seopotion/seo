import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn(async (_cmd: unknown) => ({})) }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { storeImage } from '../src/storage';

const putInput = (call: number) =>
  (send.mock.calls[call]![0] as { input: Record<string, unknown> }).input;

beforeEach(() => {
  vi.stubEnv('IMAGES_BUCKET', 'bkt');
  vi.stubEnv('IMAGES_CDN_DOMAIN', 'dxyz.cloudfront.net');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('storeImage', () => {
  test('returns null (dev fallback) when IMAGES_BUCKET is unset', async () => {
    vi.stubEnv('IMAGES_BUCKET', '');
    expect(
      await storeImage('articles/a/cover', new Uint8Array([1]), 'image/webp', 'webp'),
    ).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test('uploads with an immutable Cache-Control and returns the CDN URL', async () => {
    const url = await storeImage('articles/a/cover', new Uint8Array([1]), 'image/webp', 'webp');

    expect(url).toMatch(/^https:\/\/dxyz\.cloudfront\.net\/articles\/a\/cover-[0-9a-f]{16}\.webp$/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(putInput(0)).toMatchObject({
      Bucket: 'bkt',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    // The URL is the key, so a caller can never publish one and store the other.
    expect(url!.endsWith(putInput(0).Key as string)).toBe(true);
  });

  test('is content-addressed: identical bytes reuse the key, different bytes do not', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const first = await storeImage('articles/a/cover', bytes, 'image/webp', 'webp');
    const again = await storeImage(
      'articles/a/cover',
      new Uint8Array([1, 2, 3]),
      'image/webp',
      'webp',
    );
    const other = await storeImage(
      'articles/a/cover',
      new Uint8Array([9, 9, 9]),
      'image/webp',
      'webp',
    );

    expect(again).toBe(first);
    // Same slot, different image — a concurrent delivery must not be able to
    // overwrite bytes another delivery already published behind `immutable`.
    expect(other).not.toBe(first);
    expect(putInput(2).Key).not.toBe(putInput(0).Key);
  });

  test('keeps the extension it is given', async () => {
    const url = await storeImage('articles/a/cover', new Uint8Array([1]), 'image/png', 'png');
    expect(url).toMatch(/-[0-9a-f]{16}\.png$/);
    expect(putInput(0)).toMatchObject({ ContentType: 'image/png' });
  });

  test('throws when the bucket is set but the CDN domain is not', async () => {
    vi.stubEnv('IMAGES_CDN_DOMAIN', '');
    await expect(
      storeImage('articles/a/cover', new Uint8Array([1]), 'image/webp', 'webp'),
    ).rejects.toThrow(/IMAGES_CDN_DOMAIN/);
  });
});
