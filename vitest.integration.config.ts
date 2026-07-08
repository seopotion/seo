import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Requires MongoDB: `docker compose up -d mongo` (or set MONGO_URI).
    include: ['packages/**/tests/**/*.integration.test.ts'],
    // Integration files share one real MongoDB and several do whole-collection
    // deletes; running files in parallel forks races those deletes against each
    // other, so files must run sequentially.
    fileParallelism: false,
  },
});
