/**
 * Types for the `orch serve` subsystem.
 */

import type { Writable } from 'node:stream';

export type LogFormat = 'json' | 'text';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ServeLoggerOptions {
  format: LogFormat;
  verbose: boolean;
  streams: Writable[];
  idleLogInterval: number;
}

export interface ServeEvent {
  ts: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}
