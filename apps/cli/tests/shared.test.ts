import { afterEach, describe, expect, test, vi } from 'vitest';
import { emitInternal } from '../src/commands/shared';
import type { Emitter } from '../src/types';

afterEach(() => vi.restoreAllMocks());

describe('emitInternal', () => {
  test('emits INTERNAL result and exits with EXIT.INTERNAL (4)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    const captured: unknown[] = [];
    const fakeEmitter: Emitter = {
      step: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      result: vi.fn((data) => captured.push(data)),
    };

    expect(() => emitInternal(fakeEmitter, new Error('boom'))).toThrow('exit');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ ok: false, error: { code: 'INTERNAL', message: 'boom' } });
    expect(exitSpy).toHaveBeenCalledWith(4);
  });

  test('coerces non-Error thrown values to string', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    const captured: unknown[] = [];
    const fakeEmitter: Emitter = {
      step: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      result: vi.fn((data) => captured.push(data)),
    };

    expect(() => emitInternal(fakeEmitter, 'string error')).toThrow('exit');
    expect(captured[0]).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'string error' },
    });
  });
});
