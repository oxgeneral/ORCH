/**
 * `orch goal` command group.
 *
 * Subcommands: add, list, show, update, status, delete
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import { GOAL_STATUSES, type GoalStatus } from '../../domain/goal.js';
import { printSuccess, printError, printTable, printKeyValue, dim } from '../output.js';

const STATUS_ICON: Record<GoalStatus, string> = {
  active: '\u25CF',     // ●
  paused: '\u2016',     // ‖
  achieved: '\u2713',   // ✓
  abandoned: '\u2715',  // ✕
};

export function registerGoalCommand(program: Command, container: LightContainer): void {
  const goal = program
    .command('goal')
    .description('Manage goals');

  // goal add
  goal
    .command('add <title>')
    .description('Create a new goal')
    .option('--description <desc>', 'Goal description')
    .option('--assignee <agentId>', 'Assign to a specific agent')
    .action(async (title: string, opts: { description?: string; assignee?: string }) => {
      await container.paths.requireInit();
      const g = await container.goalService.create({
        title,
        description: opts.description,
        assignee: opts.assignee,
      });

      if (container.context.json) {
        console.log(JSON.stringify(g, null, 2));
      } else if (container.context.quiet) {
        console.log(g.id);
      } else {
        printSuccess(`Created goal "${g.title}" (${g.id})`);
      }
    });

  // goal list
  goal
    .command('list')
    .alias('ls')
    .description('List all goals')
    .option('--status <status>', 'Filter by status')
    .action(async (opts: { status?: GoalStatus }) => {
      await container.paths.requireInit();
      const goals = await container.goalService.list(
        opts.status ? { status: opts.status } : undefined,
      );

      if (container.context.json) {
        console.log(JSON.stringify(goals, null, 2));
        return;
      }

      if (goals.length === 0) {
        console.log(dim('No goals found.'));
        return;
      }

      const rows = goals.map((g) => [
        STATUS_ICON[g.status] ?? '?',
        g.id,
        g.title,
        g.status,
        g.assignee ?? dim('any'),
      ]);
      printTable(['', 'ID', 'Title', 'Status', 'Assignee'], rows);
    });

  // goal show
  goal
    .command('show <id>')
    .description('Show goal details')
    .action(async (id: string) => {
      await container.paths.requireInit();
      const g = await container.goalService.get(id);

      if (container.context.json) {
        console.log(JSON.stringify(g, null, 2));
        return;
      }

      printKeyValue([
        ['ID', g.id],
        ['Title', g.title],
        ['Status', g.status],
        ['Assignee', g.assignee ?? dim('any')],
        ['Description', g.description || dim('none')],
        ['Created', g.created_at],
        ['Updated', g.updated_at ?? dim('never')],
      ]);
    });

  // goal status
  goal
    .command('status <id> <status>')
    .description('Change goal status (active, paused, achieved, abandoned)')
    .action(async (id: string, status: string) => {
      await container.paths.requireInit();
      if (!(GOAL_STATUSES as readonly string[]).includes(status)) {
        printError(`Invalid status "${status}". Valid: ${GOAL_STATUSES.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const g = await container.goalService.updateStatus(id, status as GoalStatus);

      if (container.context.json) {
        console.log(JSON.stringify(g, null, 2));
      } else if (container.context.quiet) {
        console.log(g.id);
      } else {
        printSuccess(`Goal "${g.title}" → ${g.status}`);
      }
    });

  // goal update
  goal
    .command('update <id>')
    .description('Update goal fields')
    .option('--title <title>', 'New title')
    .option('--description <desc>', 'New description')
    .option('--assignee <agentId>', 'New assignee (empty string to unassign)')
    .action(async (id: string, opts: { title?: string; description?: string; assignee?: string }) => {
      await container.paths.requireInit();
      const g = await container.goalService.update(id, opts);

      if (container.context.json) {
        console.log(JSON.stringify(g, null, 2));
      } else if (container.context.quiet) {
        console.log(g.id);
      } else {
        printSuccess(`Updated goal "${g.title}"`);
      }
    });

  // goal delete
  goal
    .command('delete <id>')
    .alias('rm')
    .description('Delete a goal')
    .action(async (id: string) => {
      await container.paths.requireInit();
      await container.goalService.delete(id);

      if (container.context.json) {
        console.log(JSON.stringify({ deleted: id }));
      } else if (!container.context.quiet) {
        printSuccess(`Deleted goal ${id}`);
      }
    });
}
