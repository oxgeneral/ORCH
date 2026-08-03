/**
 * `orch update` command.
 *
 * Explains the explicit update path for this private secured fork.
 */

import type { Command } from 'commander';

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Show the secured fork update procedure')
    .option('--check', 'Show update procedure without changing the system')
    .action(async () => {
      console.log('This secured private fork never installs updates automatically.');
      console.log('Use the commit-pinned GitHub installation command from the README.');
    });
}
