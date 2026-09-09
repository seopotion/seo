import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { uploadImageFile } from '../src/lib/image-uploads';

let xhr: FakeXMLHttpRequest;
class FakeXMLHttpRequest {
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  upload = { onprogress: (_event: unknown) => {} };
  onload = () => {};
  onerror = () => {};
  ontimeout = () => {};
  onabort = () => {};
  status = 200;
  timeout = 0;
  constructor() {
    xhr = this;
  }
}
beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest));
afterEach(() => vi.unstubAllGlobals());

test('sends file bytes with only the prescribed S3 headers and reports progress', async () => {
  const file = new File(['image'], 'image.png', { type: 'image/png' });
  const progress = vi.fn();
  const promise = uploadImageFile(
    'https://bucket.example.com/key',
    { 'Content-Type': file.type, 'If-None-Match': '*' },
    file,
    progress,
  );
  expect(xhr.open).toHaveBeenCalledWith('PUT', 'https://bucket.example.com/key');
  expect(xhr.setRequestHeader.mock.calls).toEqual([
    ['Content-Type', 'image/png'],
    ['If-None-Match', '*'],
  ]);
  expect(xhr.send).toHaveBeenCalledWith(file);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 2, total: 5 });
  expect(progress).toHaveBeenCalledWith(40);
  xhr.onload();
  await expect(promise).resolves.toBeUndefined();
});

test.each([
  ['http', 'image_upload_failed'],
  ['network', 'image_upload_network_error'],
  ['timeout', 'image_upload_timeout'],
  ['abort', 'image_upload_cancelled'],
])('reports %s upload failures', async (kind, code) => {
  const promise = uploadImageFile(
    'https://bucket.example.com/key',
    {},
    new File(['x'], 'x'),
    vi.fn(),
  );
  if (kind === 'http') {
    xhr.status = 403;
    xhr.onload();
  }
  if (kind === 'network') xhr.onerror();
  if (kind === 'timeout') xhr.ontimeout();
  if (kind === 'abort') xhr.onabort();
  await expect(promise).rejects.toMatchObject({
    code,
    status: kind === 'http' ? 403 : 0,
  });
});
