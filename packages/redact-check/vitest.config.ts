import { defineConfig } from 'vitest/config';

// Only the pure geometry/detection module is unit-tested: it has no DOM or
// pdf.js dependency, so it runs in plain Node. The pdf.js rendering path is
// exercised in a real browser (see README).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
