import { afterEach, describe, expect, test, vi } from 'vitest';

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('storeImage', () => {
  test('returns null (dev fallback) when IMAGES_BUCKET is unset', async () => {
    vi.stubEnv('IMAGES_BUCKET', '');
    expect(await storeImage('articles/a/cover.png', new Uint8Array([1]), 'image/png')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test('uploads and returns the CDN URL', async () => {
    vi.stubEnv('IMAGES_BUCKET', 'bkt');
    vi.stubEnv('IMAGES_CDN_DOMAIN', 'dxyz.cloudfront.net');
    const url = await storeImage('articles/a/cover.png', new Uint8Array([1]), 'image/png');
    expect(url).toBe('https://dxyz.cloudfront.net/articles/a/cover.png');
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as { input: unknown }).input).toMatchObject({
      Bucket: 'bkt',
      Key: 'articles/a/cover.png',
      ContentType: 'image/png',
    });
  });

  test('throws when the bucket is set but the CDN domain is not', async () => {
    vi.stubEnv('IMAGES_BUCKET', 'bkt');
    vi.stubEnv('IMAGES_CDN_DOMAIN', '');
    await expect(storeImage('k', new Uint8Array([1]), 'image/png')).rejects.toThrow(
      /IMAGES_CDN_DOMAIN/,
    );
  });
});
