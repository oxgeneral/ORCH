import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

const isCI = !!process.env['CI'];
const maxThreads = isCI ? 2 : Math.max(2, availableParallelism());

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    pool: 'threads',
    maxWorkers: maxThreads,
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
