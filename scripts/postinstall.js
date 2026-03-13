#!/usr/bin/env node

/**
 * Post-install banner — shown once after `npm install -g @oxgeneral/orch`.
 * Pure Node.js, no dependencies.
 */

// Skip in CI or non-interactive environments
if (process.env.CI || !process.stderr.isTTY) process.exit(0);

const dim = (s) => `\x1b[38;5;240m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[38;5;72m${s}\x1b[0m`;

process.stderr.write(`
  ${green('✓')} ${bold('orchestry')} installed

  Get started:
    $ ${bold('orch')}

`);
