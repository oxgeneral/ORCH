/**
 * `orch status` command.
 *
 * One-shot overview: tasks by status, running tasks, metrics.
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import {
  statusIcon,
  priorityLabel,
  formatDurationSince,
  formatTokens,
  amber,
  dim,
  agentName,
} from '../output.js';

export function registerStatusCommand(program: Command, container: LightContainer): void {
  program
    .command('status')
    .description('Show orchestrator status')
    .action(async () => {


      const tasks = await container.taskService.list();
      const agents = await container.agentService.list();
      const state = await container.stateStore.read();

      if (container.context.json) {
        console.log(JSON.stringify({ tasks, agents, state }, null, 2));
        return;
      }

      // Header
      const runningCount = Object.keys(state.running).length;
      const mode = state.pid ? 'watching' : 'idle';
      const uptime = state.started_at ? formatDurationSince(state.started_at) : '';

      console.log();
      console.log(`${amber('orch')} · ${container.config.project.name} · ${mode}`);
      console.log();

      // Status counts
      const counts: Record<string, number> = {};
      for (const t of tasks) {
        counts[t.status] = (counts[t.status] ?? 0) + 1;
      }

      if (runningCount > 0) {
        console.log(`  ${'RUNNING'.padEnd(12)}${runningCount}${''.padEnd(20)}AGENTS  ${agents.length}`);
      }
      for (const [status, count] of Object.entries(counts)) {
        if (status !== 'in_progress') {
          console.log(`  ${dim(status.padEnd(12))}${count}`);
        }
      }

      // Running tasks
      const runningTasks = tasks.filter((t) => t.status === 'in_progress');
      if (runningTasks.length > 0) {
        console.log();
        for (const t of runningTasks) {
          const time = formatDurationSince(t.updated_at);
          console.log(
            `  ${statusIcon('in_progress')} ${t.assignee ? agentName(t.assignee) : ''}  ${t.title.slice(0, 35).padEnd(37)}${time}  ${priorityLabel(t.priority)}`,
          );
        }
      }

      // Footer
      const tt = state.stats.total_tokens;
      const tokenParts: string[] = [];
      if (tt.total > 0) {
        tokenParts.push(`\u2191${formatTokens(tt.input)}`);
        tokenParts.push(`\u2193${formatTokens(tt.output)}`);
        if (tt.reasoning > 0) tokenParts.push(`\u{1F9E0}${formatTokens(tt.reasoning)}`);
        tokenParts.push(`\u03A3${formatTokens(tt.total)}`);
      }
      const footer = [
        uptime ? `up ${uptime}` : null,
        tokenParts.length > 0 ? tokenParts.join(' ') : null,
      ]
        .filter(Boolean)
        .join(' · ');

      if (footer) {
        console.log();
        console.log(`  ${dim(footer)}`);
      }

      console.log();
    });
}
