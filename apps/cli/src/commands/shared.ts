/**
 * Shared citty arg spreads. Spread into a command's `args` for consistent flags.
 */
export const outputOption = {
  output: { type: 'string' as const, description: 'Output format: text or json', default: 'text' },
};

export const verboseOption = {
  verbose: { type: 'boolean' as const, alias: 'v', description: 'Verbose logging', default: false },
};
