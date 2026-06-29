import { afterEach, describe, expect, test, vi } from 'vitest';
import { createEmitter } from '../src/utils/emitter';

afterEach(() => vi.restoreAllMocks());

describe('emitter', () => {
  test('json result writes a single JSON object to stdout', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    createEmitter('json').result({ ok: true, data: { hello: 'world' } });
    expect(out).toHaveBeenCalledTimes(1);
    expect(JSON.parse((out.mock.calls[0]![0] as string).trim())).toEqual({ hello: 'world' });
  });

  test('json failure writes { error } to stdout', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    createEmitter('json').result({ ok: false, error: { code: 'X', message: 'bad' } });
    expect(JSON.parse((out.mock.calls[0]![0] as string).trim())).toEqual({
      error: { code: 'X', message: 'bad' },
    });
  });

  test('text failure writes the [CODE] line to stderr', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    createEmitter('text').result({ ok: false, error: { code: 'X', message: 'bad' } });
    expect(err.mock.calls[0]![0] as string).toContain('[X]');
  });
});
