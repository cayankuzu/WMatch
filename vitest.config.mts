import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
