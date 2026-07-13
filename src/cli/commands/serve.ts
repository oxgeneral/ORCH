/**
 * `orch serve` command.
 *
 * Headless daemon mode with structured JSON/text logs to stdout.
 * Designed for pm2, systemd, or background execution on servers.
 */

import fs from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import type { Writable } from 'node:stream';
import type { Command } from 'commander';
import type { Container } from '../../container.js';
import { printError } from '../output.js';
import type { LogFormat } from '../serve/types.js';

/** Suppress idle tick logs — log every Nth idle tick (~60s at default 10s interval). */
const IDLE_LOG_EVERY_N_TICKS = 6;

interface ServeOpts {
  once?: boolean;
  tickInterval?: string;
  logFile?: string;
  logFormat?: string;
  verbose?: boolean;
}

export function registerServeCommand(program: Command, container: Container): void {
  const currentVersion = program.version() ?? '0.0.0';
  program
    .command('serve')
    .description('Headless daemon mode — structured logs to stdout')
    .option('--once', 'Process todo tasks and exit when all are terminal')
    .option('--tick-interval <ms>', 'Override polling interval (ms)')
    .option('--log-file <path>', 'Also write logs to file (append mode)')
    .option('--log-format <format>', 'Log format: json or text (default: json)', 'json')
    .option('--verbose', 'Include high-frequency agent:output events')
    .action(async (opts: ServeOpts) => {
      await runServe(container, currentVersion, opts);
    });
}

const VALID_LOG_FORMATS: ReadonlySet<string> = new Set(['json', 'text']);

async function runServe(container: Container, currentVersion: string, opts: ServeOpts): Promise<void> {
  if (opts.logFormat && !VALID_LOG_FORMATS.has(opts.logFormat)) {
    printError(`Unknown --log-format "${opts.logFormat}". Valid: json, text`);
    process.exitCode = 2;
    return;
  }
  const format: LogFormat = opts.logFormat === 'text' ? 'text' : 'json';

  // Build output streams
  const streams: Writable[] = [process.stdout];
  let fileStream: fs.WriteStream | undefined;

  if (opts.logFile) {
    const fd = fs.openSync(
      opts.logFile,
      fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
    fileStream = fs.createWriteStream('', { fd, autoClose: true });
    fileStream.on('error', (err) => {
      process.stderr.write(`Log file error: ${err.message}\n`);
    });
    streams.push(fileStream);
  }

  // Override tick interval before startWatch reads it
  if (opts.tickInterval) {
    const ms = parseInt(opts.tickInterval, 10);
    if (!isNaN(ms) && ms > 0) {
      container.config.scheduling.poll_interval_ms = ms;
    }
  }

  // Create structured logger
  const { StructuredLogger } = await import('../serve/structured-logger.js');
  const logger = new StructuredLogger({
    format,
    verbose: opts.verbose ?? false,
    streams,
    idleLogInterval: IDLE_LOG_EVERY_N_TICKS,
  });

  // Subscribe before startWatch to catch the first tick
  const unsub = logger.subscribe(container.eventBus);

  // Log startup
  logger.log('info', 'serve:started', {
    mode: opts.once ? 'once' : 'watch',
    pid: process.pid,
    poll_interval_ms: container.config.scheduling.poll_interval_ms,
  });

  // Background update check — log result so operators can see it in logs
  import('../update-check.js')
    .then((m) => m.checkForUpdateSWR(currentVersion))
    .catch(() => null)
    .then((info) => {
      if (info?.updateAvailable) {
        logger.log('warn', 'update:available', {
          current: info.current,
          latest: info.latest,
          hint: 'Run: npm install -g @oxgeneral/orch',
        });
      }
    });

  try {
    if (opts.once) {
      const { runOnce } = await import('../serve/once-runner.js');

      const result = await runOnce(
        container.orchestrator,
        container.taskStore,
        container.eventBus,
      );

      logger.log('info', 'serve:finished', {
        result,
        exit_code: result === 'has_failed' ? 1 : 0,
      });

      process.exitCode = result === 'has_failed' ? 1 : 0;
    } else {
      // Watch mode: start the tick loop, then wait until stop() is called.
      // startWatch() resolves after setup + initial tick; waitForStop() keeps
      // the process alive so the logger stays subscribed for all subsequent ticks.
      await container.orchestrator.startWatch();
      await container.orchestrator.waitForStop();
    }
  } finally {
    unsub();
    await logger.flush();
  }
}
