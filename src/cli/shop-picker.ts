/**
 * Interactive terminal list picker for the Agent Shop CLI.
 *
 * Raw-mode stdin navigation — no React/Ink dependency.
 * Used by `orch agent shop` command.
 */

import * as readline from 'readline';
import chalk from 'chalk';
import type { AgentShopTemplate } from '../domain/agent-shop.js';

export async function pickFromShop(templates: AgentShopTemplate[]): Promise<AgentShopTemplate | null> {
  if (!process.stdin.isTTY) return null;

  let selected = 0;
  const pageSize = Math.min(templates.length, process.stdout.rows - 4);

  function render() {
    // Clear previous output
    process.stdout.write('\x1B[2J\x1B[H');
    console.log(chalk.bold.yellow('\n  AGENT SHOP') + chalk.gray('  — arrow keys to navigate, enter to select, q to cancel\n'));

    const start = Math.max(0, Math.min(selected - Math.floor(pageSize / 2), templates.length - pageSize));
    const end = Math.min(start + pageSize, templates.length);

    for (let i = start; i < end; i++) {
      const t = templates[i]!;
      const isSelected = i === selected;
      const cursor = isSelected ? chalk.yellow('  ▸ ') : '    ';
      const name = isSelected ? chalk.bold.white(t.name) : chalk.gray(t.name);
      const desc = chalk.gray(` — ${t.description}`);
      const model = chalk.gray.dim(` [${t.model.replace('claude-', '')}]`);
      console.log(`${cursor}${name}${desc}${model}`);
    }

    if (templates.length > pageSize) {
      console.log(chalk.gray(`\n  ${start + 1}-${end} of ${templates.length}`));
    }
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin);

    render();

    const onKeypress = (_ch: string | undefined, key: readline.Key) => {
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
        selected = (selected - 1 + templates.length) % templates.length;
        render();
      } else if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
        selected = (selected + 1) % templates.length;
        render();
      } else if (key.name === 'return') {
        cleanup();
        resolve(templates[selected]!);
      } else if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve(null);
      }
    };

    function cleanup() {
      process.stdin.removeListener('keypress', onKeypress);
      process.stdin.setRawMode(false);
      rl.close();
      process.stdout.write('\x1B[2J\x1B[H');
    }

    process.stdin.on('keypress', onKeypress);
  });
}
