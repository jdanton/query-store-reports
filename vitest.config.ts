import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environmentMatchGlobs: [
      ['tests/planRenderer.test.ts', 'happy-dom'],
    ],
    environment: 'node',
  },
});
