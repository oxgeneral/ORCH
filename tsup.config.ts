import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/bin/cli.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    sourcemap: false,
    dts: false,
    minify: false,
    treeshake: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: '#!/usr/bin/env node' },
    external: ['ink', 'react'],
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    sourcemap: true,
    dts: true,
    minify: true,
    treeshake: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['ink', 'react'],
  },
]);
