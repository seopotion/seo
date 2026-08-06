import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './apps/web'),
    },
  },
  test: {
    // Unit tests only. Integration tests (real MongoDB) are run separately via
    // vitest.integration.config.ts so `npm test` never needs Docker.
    include: ['apps/**/tests/**/*.test.ts', 'packages/**/tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
});
