import { describe, expect, test } from 'vitest';
import { stageOf } from '../src/lib/stage';

describe('stageOf', () => {
  test('localhost and 127.0.0.1 are local', () => {
    expect(stageOf('http://localhost:8788')).toBe('local');
    expect(stageOf('http://127.0.0.1:8788')).toBe('local');
    expect(stageOf('https://localhost')).toBe('local');
  });

  test('anything else is remote', () => {
    expect(stageOf('https://abc123.execute-api.eu-central-1.amazonaws.com')).toBe('remote');
    expect(stageOf('https://admin.seopotion.com/')).toBe('remote');
  });

  test('a hostname merely containing localhost is remote', () => {
    expect(stageOf('https://localhost.evil.example.com')).toBe('remote');
  });

  test('an unparseable URL fails loud rather than quiet', () => {
    expect(stageOf('not a url')).toBe('remote');
    expect(stageOf('')).toBe('remote');
  });
});
