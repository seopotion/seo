import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { optimizeImage } from '../src/lib/optimize-image';

const bitmap = { width: 1800, height: 1200, close: vi.fn() };
const context = { drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: '' };
const canvas = {
  width: 0,
  height: 0,
  getContext: vi.fn(() => context),
  toBlob: vi.fn(),
};
const decode = vi.fn();
const file = new File(['source'], 'photo.png', { type: 'image/png' });

function encoded(size: number, type = 'image/webp') {
  return new Blob([new Uint8Array(size)], { type });
}

beforeEach(() => {
  vi.resetAllMocks();
  bitmap.width = 1800;
  bitmap.height = 1200;
  decode.mockResolvedValue(bitmap);
  canvas.getContext.mockReturnValue(context);
  canvas.toBlob.mockImplementation((callback) => callback(encoded(90_000)));
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
});
afterEach(() => vi.unstubAllGlobals());

test('returns an optimized WebP file with a capped aspect ratio and releases resources', async () => {
  const result = await optimizeImage(file);
  expect(result).toMatchObject({ width: 1200, height: 800 });
  expect(result.file).toMatchObject({ name: 'photo.webp', type: 'image/webp', size: 90_000 });
  expect(result.file).not.toBe(file);
  expect(decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1200, 800);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});

test('reduces quality to meet the exact byte boundary without resizing again', async () => {
  canvas.toBlob.mockImplementationOnce((callback) => callback(encoded(100_001)));
  canvas.toBlob.mockImplementationOnce((callback) => callback(encoded(100_000)));
  const result = await optimizeImage(file);
  expect(result.file.size).toBe(100_000);
  expect(result.width).toBe(1200);
  expect(canvas.toBlob.mock.calls.map((call) => call[2])).toEqual([0.85, 0.75]);
  expect(context.drawImage).toHaveBeenCalledOnce();
});

test('reduces dimensions when quality alone cannot meet the limit', async () => {
  canvas.toBlob.mockImplementation((callback) =>
    callback(encoded(canvas.width > 1000 ? 150_000 : 80_000)),
  );
  const result = await optimizeImage(file);
  expect(result).toMatchObject({ width: 960, height: 640 });
  expect(result.file.size).toBeLessThanOrEqual(100_000);
  expect(context.drawImage).toHaveBeenCalledTimes(2);
});

test.each([
  [200, 100],
  [800, 1200],
  [1, 1200],
])('never enlarges a %i × %i source', async (width, height) => {
  bitmap.width = width;
  bitmap.height = height;
  expect(await optimizeImage(file)).toMatchObject({ width, height });
});

test('terminates with an error when the minimum dimensions still exceed the byte limit', async () => {
  canvas.toBlob.mockImplementation((callback) => callback(encoded(100_001)));
  await expect(optimizeImage(file)).rejects.toMatchObject({ code: 'image_compression_limit' });
  expect(context.drawImage.mock.lastCall).toEqual([bitmap, 0, 0, 320, 213]);
  expect(canvas.toBlob.mock.calls.length).toBeLessThanOrEqual(28);
  expect(bitmap.close).toHaveBeenCalledOnce();
});

test.each([
  [null, 'image_optimization_failed'],
  [encoded(0), 'image_optimization_failed'],
  [encoded(100, 'image/png'), 'image_webp_unsupported'],
])('rejects failed encoding or a browser format fallback', async (blob, code) => {
  canvas.toBlob.mockImplementation((callback) => callback(blob));
  await expect(optimizeImage(file)).rejects.toMatchObject({
    code,
  });
  expect(bitmap.close).toHaveBeenCalledOnce();
});

test('rejects corrupt images and sources above the pixel limit', async () => {
  decode.mockRejectedValueOnce(new Error('decode failed'));
  await expect(optimizeImage(file)).rejects.toMatchObject({ code: 'image_decode_failed' });
  bitmap.width = 10_000;
  bitmap.height = 10_000;
  await expect(optimizeImage(file)).rejects.toMatchObject({ code: 'image_decode_failed' });
  expect(canvas.toBlob).not.toHaveBeenCalled();
  expect(bitmap.close).toHaveBeenCalledOnce();
});

test.each([
  new File([], 'empty.png', { type: 'image/png' }),
  new File(['svg'], 'image.svg', { type: 'image/svg+xml' }),
  new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
])('rejects invalid input before decoding', async (source) => {
  await expect(optimizeImage(source)).rejects.toMatchObject({ code: 'invalid_image_source' });
  expect(decode).not.toHaveBeenCalled();
});
