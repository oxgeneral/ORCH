/**
 * `orch logs` command.
 *
 * View run logs: by run ID, agent, or task.
 * --follow subscribes to live events via EventBus.
 * --since filters events by time.
 */

import type { Command } from 'commander';
import type { Container } from '../../container.js';
import type { RunEvent } from '../../domain/run.js';
import type { OrchestratorEvent } from '../../domain/events.js';
import { printError, dim, getIcon } from '../output.js';
import { InvalidArgumentsError } from '../../domain/errors.js';

export function registerLogsCommand(program: Command, container: Container): void {
  program
    .command('logs [run-id]')
    .description('View run logs')
    .option('--agent <agent-id>', 'Filter by agent')
    .option('--task <task-id>', 'Filter by task')
    .option('--follow', 'Live stream')
    .option('--since <duration>', 'Filter by time (e.g. 5m, 1h)')
    .action(async (runId: string | undefined, opts: {
      agent?: string;
      task?: string;
      follow?: boolean;
      since?: string;
    }) => {
      await container.paths.requireInit();

      const sinceMs = opts.since ? parseDuration(opts.since) : undefined;

      if (opts.follow) {
        await followLive(container, { runId, taskId: opts.task, agentId: opts.agent });
      } else if (runId) {
        await showRunLogs(container, runId, sinceMs);
      } else if (opts.task) {
        await showTaskLogs(container, opts.task, sinceMs);
      } else if (opts.agent) {
        await showAgentLogs(container, opts.agent, sinceMs);
      } else {
        printError('Specify a run ID, --task, or --agent');
        process.exit(2);
      }
    });
}

function formatEvent(event: RunEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const icon = event.type === 'error' ? getIcon('failed') : getIcon('agentAction');
  const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
  return `  ${dim(time)}  ${icon} ${data.slice(0, 80)}`;
}

function filterBySince(events: RunEvent[], sinceMs: number | undefined): RunEvent[] {
  if (!sinceMs) return events;
  const cutoff = Date.now() - sinceMs;
  return events.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}

async function showRunLogs(container: Container, runId: string, sinceMs?: number): Promise<void> {
  let events = await container.runService.readEvents(runId);
  events = filterBySince(events, sinceMs);

  if (container.context.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(`\n  No events for run ${runId}\n`);
    return;
  }

  console.log();
  for (const event of events) {
    console.log(formatEvent(event));
  }
  console.log();
}

async function showTaskLogs(container: Container, taskId: string, sinceMs?: number): Promise<void> {
  const runs = await container.runService.listForTask(taskId);

  if (container.context.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  if (runs.length === 0) {
    console.log(`\n  No runs for task ${taskId}\n`);
    return;
  }

  for (const run of runs) {
    console.log(`\n  Run ${run.id} · attempt ${run.attempt} · ${run.status}`);
    let events = await container.runService.readEventsTail(run.id, 10);
    events = filterBySince(events, sinceMs);
    for (const event of events) {
      console.log(formatEvent(event));
    }
  }
  console.log();
}

async function showAgentLogs(container: Container, agentId: string, sinceMs?: number): Promise<void> {
  const runs = await container.runService.listForAgent(agentId);

  if (container.context.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  if (runs.length === 0) {
    console.log(`\n  No runs for agent ${agentId}\n`);
    return;
  }

  for (const run of runs.slice(-5)) {
    console.log(`\n  Run ${run.id} · task ${run.task_id} · ${run.status}`);
    let events = await container.runService.readEventsTail(run.id, 5);
    events = filterBySince(events, sinceMs);
    for (const event of events) {
      console.log(formatEvent(event));
    }
  }
  console.log();
}

/**
 * Live follow mode — subscribe to EventBus and stream events to stdout.
 * Blocks until SIGINT/SIGTERM.
 */
async function followLive(
  container: Container,
  filter: { runId?: string; taskId?: string; agentId?: string },
): Promise<void> {
  // Build lookup sets for filtering
  const runIds = new Set<string>();
  const agentIds = new Set<string>();

  if (filter.runId) {
    runIds.add(filter.runId);
  }
  if (filter.taskId) {
    const runs = await container.runService.listForTask(filter.taskId);
    for (const r of runs) runIds.add(r.id);
  }
  if (filter.agentId) {
    agentIds.add(filter.agentId);
  }

  const hasFilter = runIds.size > 0 || agentIds.size > 0;

  console.log(`\n  ${dim('Following live events...')} ${dim('(Ctrl+C to stop)')}\n`);

  const unsub = container.eventBus.onAny((event) => {
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Apply filters
    if (hasFilter) {
      if ('runId' in event && runIds.size > 0 && !runIds.has(event.runId)) return;
      if ('agentId' in event && agentIds.size > 0) {
        const evt = event as Extract<OrchestratorEvent, { agentId: string }>;
        if (!agentIds.has(evt.agentId)) return;
      }
    }

    switch (event.type) {
      case 'agent:output': {
        const data = typeof event.data === 'string' ? event.data.slice(0, 80) : '';
        console.log(`  ${dim(time)}  ${getIcon('agentAction')} ${data}`);
        break;
      }
      case 'agent:file_changed':
        console.log(`  ${dim(time)}  ${getIcon('agentAction')} Modified ${event.path}`);
        break;
      case 'agent:error':
        console.log(`  ${dim(time)}  ${getIcon('failed')} ${event.error}`);
        break;
      case 'agent:started':
        console.log(`  ${dim(time)}  ${getIcon('orchestratorEvent')} Started ${event.runId} (agent: ${event.agentId})`);
        break;
      case 'agent:completed':
        if (event.success) {
          console.log(`  ${dim(time)}  ${getIcon('done')} DONE  ${event.runId}`);
        } else {
          console.log(`  ${dim(time)}  ${getIcon('failed')} FAIL  ${event.runId}`);
        }
        break;
      case 'run:retry':
        console.log(`  ${dim(time)}  ${getIcon('retrying')} RETRY  attempt ${event.attempt} · next in ${Math.round(event.delay_ms / 1000)}s`);
        break;
      case 'orchestrator:stall_detected':
        console.log(`  ${dim(time)}  ${getIcon('warning')} STALL  ${event.runId}`);
        break;
    }
  });

  // Block until signal
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      unsub();
      resolve();
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
}

/**
 * Parse duration string like "5m", "1h", "30s" to milliseconds.
 */
function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new InvalidArgumentsError(`Invalid duration: "${input}". Use format: 5m, 1h, 30s, 1d`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case 's': return value * 1_000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    case 'd': return value * 86_400_000;
    default: return value * 60_000;
  }
}
