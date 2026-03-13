import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 4,
      },
    },
    typecheck: {
      tsconfig: 'tsconfig.test.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/bin/**', 'src/cli/tui/**'],
    },
  },
  optimizeDeps: {
    include: ['vitest', 'js-yaml', 'nanoid', 'commander'],
  },
});
