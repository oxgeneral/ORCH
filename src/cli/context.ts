/**
 * CLI context — resolved project root and global flags.
 *
 * Validated at entry point before any command runs.
 */

import { findProjectRoot } from '../infrastructure/storage/paths.js';

export interface CliContext {
  projectRoot: string;
  json: boolean;
  quiet: boolean;
  noColor: boolean;
  ascii: boolean;
}

export function createContext(opts: {
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  ascii?: boolean;
}): CliContext {
  const noColor =
    opts.noColor ||
    process.env['NO_COLOR'] === '1' ||
    false;

  const ascii =
    opts.ascii ||
    process.env['TERM'] === 'dumb' ||
    false;

  return {
    projectRoot: findProjectRoot(),
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
    noColor,
    ascii,
  };
}
