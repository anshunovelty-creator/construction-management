import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // PGlite starts a real Postgres in-process; the first start takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
