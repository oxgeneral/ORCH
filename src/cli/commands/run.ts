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
    .action(async (taskId: string | undefined, opts: { all?: boolean; watch?: boolean }) => {
      await container.paths.requireInit();

      if (opts.watch) {
        await runWatch(container);
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

  // Subscribe to events for live output
  const unsub = container.eventBus.onAny((event) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    switch (event.type) {
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
        if (event.success) {
          printSuccess('Done');
        } else {
          printError('Failed');
        }
        break;
    }
  });

  try {
    await container.orchestrator.runTask(taskId);
  } finally {
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

async function runWatch(container: Container): Promise<void> {
  console.log(`${amber('orch')} · watching · poll interval ${container.config.scheduling.poll_interval_ms / 1000}s`);
  console.log('━'.repeat(43));
  console.log();

  // Subscribe to events for log stream
  container.eventBus.onAny((event) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    switch (event.type) {
      case 'agent:output': {
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

  // Orchestrator registers its own SIGINT/SIGTERM handlers in startWatch(),
  // which call stop() for graceful shutdown (flush state, release lock, kill agents).
  // After stop() clears the interval and removes listeners, Node exits naturally.
  await container.orchestrator.startWatch();
}
