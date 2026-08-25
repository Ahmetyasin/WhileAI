import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts'],
  },
});
