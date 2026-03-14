#!/usr/bin/env node

/**
 * Post-install: patch Ink caches + show banner.
 * Pure Node.js, no dependencies.
 */

// Patch Ink's unbounded caches before anything else
try {
  const { readFileSync, writeFileSync, existsSync } = require('node:fs');
  const { join } = require('node:path');
  const inkBuild = join(__dirname, '..', 'node_modules', 'ink', 'build');
  const MAX = 2000;

  const wrapPath = join(inkBuild, 'wrap-text.js');
  if (existsSync(wrapPath)) {
    let s = readFileSync(wrapPath, 'utf8');
    if (!s.includes('_lruKeys')) {
      s = s.replace('const cache = {};', `const cache = {};\nconst _lruKeys = [];\nconst _MAX = ${MAX};`);
      s = s.replace('cache[cacheKey] = wrappedText;', `cache[cacheKey] = wrappedText;\n    _lruKeys.push(cacheKey);\n    if (_lruKeys.length > _MAX) { delete cache[_lruKeys.shift()]; }`);
      writeFileSync(wrapPath, s);
    }
  }

  const measurePath = join(inkBuild, 'measure-text.js');
  if (existsSync(measurePath)) {
    let s = readFileSync(measurePath, 'utf8');
    if (!s.includes('_MAX_MT')) {
      s = s.replace('const cache = new Map();', `const cache = new Map();\nconst _MAX_MT = ${MAX};`);
      s = s.replace('cache.set(text, dimensions);', `cache.set(text, dimensions);\n    if (cache.size > _MAX_MT) { const first = cache.keys().next().value; cache.delete(first); }`);
      writeFileSync(measurePath, s);
    }
  }
  // Patch output.js: add LRU eviction to OutputCaches maps
  const outputPath = join(inkBuild, 'output.js');
  if (existsSync(outputPath)) {
    let s = readFileSync(outputPath, 'utf8');
    if (!s.includes('_OC_MAX')) {
      // Add LRU bound to all three Maps in OutputCaches
      const lru = (prop) => `\n        if (this.${prop}.size > _OC_MAX) { const k = this.${prop}.keys().next().value; this.${prop}.delete(k); }`;
      s = s.replace('class OutputCaches {', `const _OC_MAX = ${MAX};\nclass OutputCaches {`);
      s = s.replace('this.styledChars.set(line, cached);', `this.styledChars.set(line, cached);${lru('styledChars')}`);
      s = s.replace('this.widths.set(text, cached);', `this.widths.set(text, cached);${lru('widths')}`);
      s = s.replace('this.blockWidths.set(text, cached);', `this.blockWidths.set(text, cached);${lru('blockWidths')}`);
      writeFileSync(outputPath, s);
    }
  }
} catch { /* non-fatal: caches will just be unbounded */ }

// Skip banner in CI or non-interactive environments
if (process.env.CI || !process.stderr.isTTY) process.exit(0);

// Color values synced with src/cli/output.ts colors map
const dim = (s) => `\x1b[38;5;240m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[38;5;72m${s}\x1b[0m`;

process.stderr.write(`
  ${green('✓')} ${bold('orchestry')} installed

  Get started:
    $ ${bold('orch')}

`);
