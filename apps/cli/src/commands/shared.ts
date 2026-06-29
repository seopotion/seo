/**
 * Shared citty arg spreads. Spread into a command's `args` for consistent flags.
 */
import type { Emitter } from '../types';
import { EXIT, fail } from '../types';

export const outputOption = {
  output: { type: 'string' as const, description: 'Output format: text or json', default: 'text' },
};

export const verboseOption = {
  verbose: { type: 'boolean' as const, alias: 'v', description: 'Verbose logging', default: false },
};

/**
 * Emit an INTERNAL error result and exit with EXIT.INTERNAL (4).
 * Call this from a command's catch block to handle unexpected throws.
 */
export function emitInternal(emitter: Emitter, e: unknown): never {
  emitter.result(fail('INTERNAL', e instanceof Error ? e.message : String(e)));
  return process.exit(EXIT.INTERNAL);
}
