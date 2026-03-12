/**
 * Terminal output helpers.
 *
 * All formatting, icons, colors go through this module.
 * Respects NO_COLOR, --ascii, --json, --quiet flags.
 */

import chalk from 'chalk';
import type { TaskStatus } from '../domain/task.js';
import type { AgentStatus } from '../domain/agent.js';

// Unicode icons
export const icons = {
  running: '●',
  todo: '○',
  review: '◈',
  done: '✓',
  failed: '✕',
  retrying: '↻',
  cancelled: '○',
  idle: '○',
  error: '✕',
  disabled: '─',
  agentAction: '▸',
  orchestratorEvent: '→',
  warning: '⚠',
} as const;

// ASCII fallback
const asciiIcons: Record<keyof typeof icons, string> = {
  running: '*',
  todo: 'o',
  review: '#',
  done: '+',
  failed: 'x',
  retrying: '~',
  cancelled: 'o',
  idle: 'o',
  error: 'x',
  disabled: '-',
  agentAction: '>',
  orchestratorEvent: '->',
  warning: '!!',
};

// ANSI 256 colors from CLI_UI_DESIGN.md
const colors = {
  amber: chalk.ansi256(214),
  green: chalk.ansi256(72),
  red: chalk.ansi256(167),
  blue: chalk.ansi256(74),
  yellow: chalk.ansi256(178),
  dim: chalk.ansi256(240),
  ghost: chalk.ansi256(236),
  white: chalk.ansi256(255),
  purple: chalk.ansi256(141),
};

let useAscii = false;

export function setAsciiMode(ascii: boolean): void {
  useAscii = ascii;
}

export function setNoColor(noColor: boolean): void {
  if (noColor) {
    chalk.level = 0;
  }
}

export function getIcon(name: keyof typeof icons): string {
  return useAscii ? asciiIcons[name] : icons[name];
}

export function statusIcon(status: TaskStatus | AgentStatus): string {
  const icon = getIcon(status as keyof typeof icons);
  switch (status) {
    case 'running':
    case 'in_progress':
      return colors.green(getIcon('running'));
    case 'todo':
      return colors.dim(getIcon('todo'));
    case 'review':
      return colors.blue(getIcon('review'));
    case 'done':
      return colors.green(getIcon('done'));
    case 'failed':
      return colors.red(getIcon('failed'));
    case 'retrying':
      return colors.yellow(getIcon('retrying'));
    case 'cancelled':
      return colors.dim(getIcon('cancelled'));
    case 'idle':
      return colors.dim(getIcon('idle'));
    case 'error':
      return colors.red(getIcon('error'));
    case 'disabled':
      return colors.ghost(getIcon('disabled'));
    default:
      return icon;
  }
}

export function priorityLabel(priority: number): string {
  switch (priority) {
    case 1:
      return colors.red('P1');
    case 2:
      return colors.yellow('P2');
    case 3:
      return 'P3';
    case 4:
      return colors.dim('P4');
    default:
      return `P${priority}`;
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}:${String(secs).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${String(mins).padStart(2, '0')}m`;
}

export function formatDurationSince(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  return formatDuration(ms);
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function printError(message: string, hint?: string): void {
  console.error(`  ${colors.red(getIcon('failed'))} ${message}`);
  if (hint) {
    console.error(`    ${hint}`);
  }
}

export function printSuccess(message: string): void {
  console.log(`  ${colors.green(getIcon('done'))} ${message}`);
}

export function printWarning(message: string): void {
  console.log(`  ${colors.yellow(getIcon('warning'))} ${message}`);
}

export function printTable(
  headers: string[],
  rows: string[][],
  padding: number = 2,
): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] ?? '').length)),
  );

  const headerLine = headers
    .map((h, i) => h.padEnd(colWidths[i]! + padding))
    .join('');
  console.log(`  ${colors.dim(headerLine)}`);

  for (const row of rows) {
    const line = row
      .map((cell, i) => {
        const stripped = stripAnsi(cell);
        const pad = (colWidths[i] ?? 0) + padding - stripped.length;
        return cell + ' '.repeat(Math.max(0, pad));
      })
      .join('');
    console.log(`  ${line}`);
  }
}

export function printKeyValue(pairs: Array<[string, string]>): void {
  const maxKey = Math.max(...pairs.map(([k]) => k.length));
  for (const [key, value] of pairs) {
    console.log(`  ${colors.dim(key.padEnd(maxKey + 2))}${value}`);
  }
}

export function filePath(p: string): string {
  return colors.purple(p);
}

export function agentName(name: string): string {
  return colors.green(name);
}

export function amber(text: string): string {
  return colors.amber(text);
}

export function dim(text: string): string {
  return colors.dim(text);
}

// Simple ANSI strip
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
