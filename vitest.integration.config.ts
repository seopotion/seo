import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Requires MongoDB: `docker compose up -d mongo` (or set MONGO_URI).
    include: ['packages/**/tests/**/*.integration.test.ts'],
  },
});
