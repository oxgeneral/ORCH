/**
 * `orch update` command.
 *
 * Checks for the latest version and optionally installs it.
 */

import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import { checkForUpdateNow } from '../update-check.js';
import { amber, dim } from '../output.js';
import chalk from 'chalk';

const PACKAGE_NAME = '@oxgeneral/orch';

function runInstall(version: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      'npm',
      ['install', '-g', `${PACKAGE_NAME}@${version}`],
      { timeout: 60_000 },
      (err, stdout, stderr) => {
        const output = (stdout ?? '') + (stderr ?? '');
        resolve({ code: err ? 1 : 0, output });
      },
    );
    // Stream output in real-time
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Check for updates and install the latest version')
    .option('--check', 'Only check, do not install')
    .action(async (opts: { check?: boolean }) => {
      console.log();
      console.log(`  ${amber('orch update')} · checking for updates…`);
      console.log();

      // Read current version from package.json at runtime
      const currentVersion = program.version() ?? '0.0.0';

      const info = await checkForUpdateNow(currentVersion);

      if (!info) {
        console.log(`  ${chalk.ansi256(167)('✕')}  Could not reach npm registry`);
        console.log(`     Check your network connection and try again.`);
        console.log();
        process.exit(1);
      }

      if (!info.updateAvailable) {
        console.log(`  ${chalk.ansi256(72)('✓')}  Already up to date ${dim(`(${info.current})`)}`);
        console.log();
        return;
      }

      console.log(`  ${chalk.ansi256(214)('●')}  Update available: ${dim(info.current)} → ${chalk.ansi256(72)(info.latest)}`);
      console.log();

      if (opts.check) {
        console.log(`  Run ${dim('orch update')} to install.`);
        console.log();
        return;
      }

      console.log(`  Installing ${PACKAGE_NAME}@${info.latest}…`);
      console.log();

      const result = await runInstall(info.latest);

      if (result.code !== 0) {
        console.log();
        console.log(`  ${chalk.ansi256(167)('✕')}  Update failed. Try manually:`);
        console.log(`     npm install -g ${PACKAGE_NAME}@${info.latest}`);
        console.log();
        process.exit(1);
      }

      console.log();
      console.log(`  ${chalk.ansi256(72)('✓')}  Updated to ${info.latest}`);
      console.log();
    });
}
