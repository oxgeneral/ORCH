/**
 * `orch run` command.
 *
 * Modes: single task, --all, --watch
 */

import type { Command } from 'commander';
import type { Container } from '../../container.js';
import { printSuccess, printError, amber, dim, agentName, getIcon } from '../output.js';

export function registerRunCommand(program: Command, container: Container): void {
  program
    .command('run [task-id]')
    .description('Run tasks')
    .option('--all', 'Run all todo tasks')
    .option('--watch', 'Watch mode: continuous orchestration')
    .option('--verbose', 'Include agent output in watch mode')
    .action(async (taskId: string | undefined, opts: { all?: boolean; watch?: boolean; verbose?: boolean }) => {

      if (opts.watch) {
        await runWatch(container, opts.verbose ?? false);
      } else if (opts.all) {
        await runAll(container);
      } else if (taskId) {
        await runSingle(container, taskId);
      } else {
        printError('Specify a task ID, --all, or --watch');
        process.exit(2);
      }
    });
}

async function runSingle(container: Container, taskId: string): Promise<void> {
  const task = await container.taskService.get(taskId);
  console.log();
  console.log(`  ${amber('orch')} · running ${taskId} "${task.title}"`);

  let targetRunId: string | undefined;
  let unsub = () => {};

  // Subscribe to events for live output
  unsub = container.eventBus.onAny((event) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    switch (event.type) {
      case 'agent:started':
        if (event.taskId === taskId) {
          targetRunId = event.runId;
        }
        break;
      case 'agent:output':
        console.log(`  ${dim(time)}  ${getIcon('agentAction')} ${typeof event.data === 'string' ? event.data.slice(0, 80) : ''}`);
        break;
      case 'agent:file_changed':
        console.log(`  ${dim(time)}  ${getIcon('agentAction')} Modified ${event.path}`);
        break;
      case 'agent:error':
        console.log(`  ${dim(time)}  ${getIcon('failed')} ${event.error}`);
        break;
      case 'agent:completed':
        if (event.runId !== targetRunId) break;
        if (event.success) {
          printSuccess('Done');
        } else {
          printError('Failed');
          process.exitCode = 1;
        }
        unsub();
        break;
    }
  });

  try {
    await container.orchestrator.runTask(taskId);
  } catch (error) {
    unsub();
    throw error;
  }

  // A terminal/non-dispatchable task may not emit a run lifecycle. Normal
  // dispatched runs keep the listener until their asynchronous collector emits
  // agent:completed, so output and the final exit code are not lost.
  if (!targetRunId) {
    unsub();
  }

  console.log();
}

async function runAll(container: Container): Promise<void> {
  console.log();
  console.log(`  ${amber('orch')} · running all todo tasks`);
  console.log();

  await container.orchestrator.runAll();
}

async function runWatch(container: Container, verbose: boolean): Promise<void> {
  console.log(`${amber('orch')} · watching · poll interval ${container.config.scheduling.poll_interval_ms / 1000}s`);
  console.log('━'.repeat(43));
  console.log();

  // Subscribe to events for log stream
  container.eventBus.onAny((event) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    switch (event.type) {
      case 'agent:output': {
        if (!verbose) break;
        const data = typeof event.data === 'string' ? event.data.slice(0, 60) : '';
        console.log(`${dim(time)}  ${getIcon('agentAction')} ${data}`);
        break;
      }
      case 'agent:completed':
        if (event.success) {
          console.log(`${dim(time)}  ${getIcon('done')} DONE  ${event.runId}`);
        } else {
          console.log(`${dim(time)}  ${getIcon('failed')} FAIL  ${event.runId}`);
        }
        break;
      case 'run:retry':
        console.log(`${dim(time)}  ${getIcon('retrying')} RETRY  attempt ${event.attempt} · next in ${Math.round(event.delay_ms / 1000)}s`);
        break;
      case 'orchestrator:tick':
        // Update status line
        process.stdout.write(`\r${amber('orch')} · watching · ${event.running} running · ${event.queued} queued    `);
        break;
      case 'orchestrator:stall_detected':
        console.log(`${dim(time)}  ${getIcon('warning')} STALL  ${event.runId}`);
        break;
      case 'orchestrator:shutdown':
        console.log(`\n${dim('Shutting down...')}`);
        break;
    }
  });

  // startWatch() starts the tick loop and returns after the first tick.
  // waitForStop() keeps the process alive until SIGINT/SIGTERM triggers graceful shutdown.
  await container.orchestrator.startWatch();
  await container.orchestrator.waitForStop();
}
