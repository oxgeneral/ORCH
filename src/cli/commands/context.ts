/**
 * `orch context` command group.
 *
 * Subcommands: set, get, list, delete
 * Shared key-value store for inter-agent context exchange.
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import {
  printError,
  printSuccess,
  printTable,
  dim,
  formatDurationSince,
} from '../output.js';

export function registerContextCommand(program: Command, container: LightContainer): void {
  const ctx = program
    .command('context')
    .description('Shared context store for inter-agent data exchange');

  // context set
  ctx
    .command('set <key> <value>')
    .description('Set a shared context entry')
    .option('--ttl <ms>', 'Time-to-live in milliseconds')
    .action(async (key: string, value: string, opts) => {
      await container.paths.requireInit();

      const ttlMs = opts.ttl ? parseInt(opts.ttl, 10) : undefined;
      await container.contextStore.set(key, value, ttlMs);

      if (container.context.json) {
        const entry = await container.contextStore.get(key);
        console.log(JSON.stringify(entry, null, 2));
      } else if (container.context.quiet) {
        console.log(key);
      } else {
        printSuccess(`Set context "${key}"`);
      }
    });

  // context get
  ctx
    .command('get <key>')
    .description('Get a shared context entry')
    .action(async (key: string) => {
      await container.paths.requireInit();

      const entry = await container.contextStore.get(key);

      if (!entry) {
        if (container.context.json) {
          console.log('null');
        } else {
          printError(`Context key "${key}" not found`);
        }
        return;
      }

      if (container.context.json) {
        console.log(JSON.stringify(entry, null, 2));
      } else if (container.context.quiet) {
        console.log(entry.value);
      } else {
        console.log(`\n  ${key} = ${entry.value}`);
        if (entry.expires_at) {
          console.log(`  ${dim(`expires: ${entry.expires_at}`)}`);
        }
        console.log();
      }
    });

  // context list
  ctx
    .command('list')
    .description('List all shared context entries')
    .action(async () => {
      await container.paths.requireInit();

      const entries = await container.contextStore.list();

      if (container.context.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      if (container.context.quiet) {
        entries.forEach((e) => console.log(`${e.key}=${e.value}`));
        return;
      }

      if (entries.length === 0) {
        console.log(`\n  No shared context entries. Set one: ${dim('orch context set key value')}\n`);
        return;
      }

      const headers = ['KEY', 'VALUE', 'UPDATED', 'TTL'];
      const rows = entries.map((e) => [
        e.key,
        e.value.length > 50 ? e.value.slice(0, 47) + '...' : e.value,
        formatDurationSince(e.updated_at),
        e.expires_at ? formatDurationSince(e.expires_at) : dim('—'),
      ]);

      console.log();
      printTable(headers, rows);
      console.log(`\n  ${entries.length} entries\n`);
    });

  // context delete
  ctx
    .command('delete <key>')
    .description('Delete a shared context entry')
    .action(async (key: string) => {
      await container.paths.requireInit();
      await container.contextStore.delete(key);

      if (!container.context.quiet && !container.context.json) {
        printSuccess(`Deleted context "${key}"`);
      }
    });
}
