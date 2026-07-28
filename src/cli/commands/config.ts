/**
 * `orch config` command group.
 *
 * Subcommands: get, set, edit
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import {
  isTuiPaletteName,
  TUI_PALETTE_NAMES,
  type ActivityFilterPreset,
} from '../../domain/global-config.js';
import { printSuccess, printError, dim } from '../output.js';
import { spawn } from 'node:child_process';

const VALID_FILTER_PRESETS: ActivityFilterPreset[] = ['all', 'text', 'tools', 'errors', 'events'];

export function registerConfigCommand(program: Command, container: LightContainer): void {
  const config = program
    .command('config')
    .description('Manage configuration');

  // config get
  config
    .command('get <key>')
    .description('Get a config value (dot notation)')
    .action(async (key: string) => {

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


      const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'vi';
      const parts = editor.split(/\s+/);
      const child = spawn(parts[0]!, [...parts.slice(1), container.paths.configPath], {
        stdio: 'inherit',
      });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Editor exited with code ${code}`));
        });
        child.on('error', reject);
      });
    });

  // ── Global config (cross-project, ~/.orchestry/global.yml) ──

  const global = config
    .command('global')
    .description('Manage global settings (~/.orchestry/global.yml)');

  global
    .command('get <key>')
    .description('Get a global config value')
    .action(async (key: string) => {
      const gc = await container.globalConfigStore.read();
      const value = key === 'activity_filter'
        ? gc.tui.activity_filter
        : key === 'palette'
          ? gc.tui.palette
          : undefined;
      if (container.context.json) {
        console.log(JSON.stringify({ key, value }));
      } else {
        console.log(`  ${dim(key)} = ${JSON.stringify(value)}`);
      }
    });

  global
    .command('set <key> <value>')
    .description('Set a global config value')
    .action(async (key: string, value: string) => {
      if (key === 'activity_filter') {
        if (!(VALID_FILTER_PRESETS as readonly string[]).includes(value)) {
          printError(`Invalid value "${value}". Valid: ${VALID_FILTER_PRESETS.join(', ')}`);
          return;
        }
        await container.globalConfigStore.set('activity_filter', value as ActivityFilterPreset);
        printSuccess(`${key} = ${value}`);
      } else if (key === 'palette') {
        const palette = value.toLowerCase();
        if (!isTuiPaletteName(palette)) {
          printError(`Invalid value "${value}". Valid: ${TUI_PALETTE_NAMES.join(', ')}`);
          return;
        }
        await container.globalConfigStore.set('palette', palette);
        printSuccess(`${key} = ${palette}`);
      } else {
        printError(`Unknown global config key: ${key}`);
      }
    });

  global
    .command('show')
    .description('Show all global settings')
    .action(async () => {
      const gc = await container.globalConfigStore.read();
      if (container.context.json) {
        console.log(JSON.stringify(gc));
      } else {
        console.log(`  ${dim('tui.activity_filter')} = ${gc.tui.activity_filter}`);
        console.log(`  ${dim('tui.palette')} = ${gc.tui.palette}`);
      }
    });
}
