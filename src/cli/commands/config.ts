/**
 * `orch config` command group.
 *
 * Subcommands: get, set, edit
 */

import type { Command } from 'commander';
import type { Container } from '../../container.js';
import { printSuccess, printError, dim } from '../output.js';
import { execFile } from 'node:child_process';

export function registerConfigCommand(program: Command, container: Container): void {
  const config = program
    .command('config')
    .description('Manage configuration');

  // config get
  config
    .command('get <key>')
    .description('Get a config value (dot notation)')
    .action(async (key: string) => {
      await container.paths.requireInit();
      const value = await container.configStore.get(key);

      if (container.context.json) {
        console.log(JSON.stringify({ key, value }));
      } else {
        console.log(`  ${dim(key)} = ${JSON.stringify(value)}`);
      }
    });

  // config set
  config
    .command('set <key> <value>')
    .description('Set a config value (dot notation)')
    .action(async (key: string, value: string) => {
      await container.paths.requireInit();

      // Try to parse as JSON, fallback to string
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }

      await container.configStore.set(key, parsed);
      printSuccess(`${key} = ${JSON.stringify(parsed)}`);
    });

  // config edit
  config
    .command('edit')
    .description('Open config.yml in $EDITOR')
    .action(async () => {
      await container.paths.requireInit();

      const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'vi';
      const child = execFile(editor, [container.paths.configPath], {
        stdio: 'inherit',
      } as any);

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Editor exited with code ${code}`));
        });
        child.on('error', reject);
      });
    });
}
