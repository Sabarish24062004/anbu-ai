import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Integration tests share one test database; run files sequentially.
    fileParallelism: false,
    // Password hashing is deliberately slow (scrypt, 128 MB); a busy machine needs headroom.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
