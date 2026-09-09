import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only. Integration tests (real MongoDB) are run separately via
// vitest.integration.config.ts so `npm test` never needs Docker.
//
// Both of these are repeated inside each project on purpose. Inline projects do
// not inherit `resolve` at all, and a project's own `exclude` replaces rather
// than merges with the one above it — so leaving either off silently breaks
// `@/…` imports or lets the integration suites back in.
const exclude = [...configDefaults.exclude, '**/*.integration.test.ts'];
const resolve = {
  alias: {
    '@': path.resolve(__dirname, './apps/web'),
  },
};

export default defineConfig({
  resolve,
  test: {
    exclude,
    // Projects split by file extension and app: `.test.ts` runs in node, `.test.tsx`
    // runs in jsdom. Component tests need a DOM, but the ~146 backend/shared
    // suites must stay on node — jsdom would slow them down and could mask
    // node-only bugs.
    projects: [
      {
        resolve,
        test: {
          name: 'node',
          include: [
            'apps/**/tests/**/*.test.ts',
            'packages/**/tests/**/*.test.ts',
            // Standalone CDK package (own node_modules); only its git-only guard is unit-tested here.
            'infra/tests/**/*.test.ts',
          ],
          exclude,
        },
      },
      {
        resolve,
        test: {
          name: 'web-dom',
          include: ['apps/web/tests/**/*.test.tsx'],
          exclude,
          environment: 'jsdom',
          setupFiles: ['./apps/web/tests/setup-dom.ts'],
        },
      },
      {
        resolve,
        test: {
          name: 'admin-dom',
          include: ['apps/admin/tests/**/*.test.tsx'],
          exclude,
          environment: 'jsdom',
          setupFiles: ['./apps/admin/tests/setup-dom.ts'],
        },
      },
    ],
  },
});
