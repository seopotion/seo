import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';

describe('secret crypto (AES-256-GCM)', () => {
  const key = randomBytes(32);

  test('round-trips a refresh token', () => {
    const payload = encryptSecret('1//refresh-token-value', key);
    expect(payload).not.toContain('refresh-token-value');
    expect(decryptSecret(payload, key)).toBe('1//refresh-token-value');
  });

  test('unique IV per call: same plaintext, different ciphertext', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  test('rejects the wrong key', () => {
    const payload = encryptSecret('secret', key);
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
  });

  test('rejects a tampered payload', () => {
    const buf = Buffer.from(encryptSecret('secret', key), 'base64');
    // biome-ignore lint/suspicious/noExplicitAny: TypeScript Buffer index access issue
    (buf as any)[buf.length - 1] ^= 0xff;
    expect(() => decryptSecret(buf.toString('base64'), key)).toThrow();
  });
});
