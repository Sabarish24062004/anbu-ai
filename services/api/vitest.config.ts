import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Integration tests share one test database; run files sequentially.
    fileParallelism: false,
  },
});
