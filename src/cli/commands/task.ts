/**
 * `orch task` command group.
 *
 * Subcommands: add, list, show, edit, assign, cancel, retry
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import { InvalidArgumentsError } from '../../domain/errors.js';
import {
  statusIcon,
  priorityLabel,
  printError,
  printSuccess,
  printTable,
  printKeyValue,
  formatDurationSince,
  formatTokens,
  filePath,
  dim,
  agentName,
} from '../output.js';
// editor.ts loaded lazily — only needed for task add --edit and task edit

export function registerTaskCommand(program: Command, container: LightContainer): void {
  const task = program
    .command('task')
    .description('Manage tasks');

  // task add
  task
    .command('add <title>')
    .description('Create a new task')
    .option('-d, --description <desc>', 'Task description')
    .option('-p, --priority <n>', 'Priority (1-4)', '3')
    .option('-l, --labels <labels>', 'Comma-separated labels')
    .option('--depends-on <ids>', 'Comma-separated dependency task IDs')
    .option('--max-attempts <n>', 'Max retry attempts')
    .option('--workspace-mode <mode>', 'Workspace mode: shared|worktree|isolated')
    .option('--assignee <agent-id>', 'Assign to agent')
    .option('--review-criteria <criteria>', 'Comma-separated auto-review criteria: test_pass,typecheck,lint')
    .option('--scope <patterns>', 'Comma-separated glob patterns for file scope (e.g. src/auth/**,src/session/**)')
    .option('--goal-id <goalId>', 'Associate task with a goal')
    .option('--goal-role <role>', 'Goal role: worker')
    .option('--goal-cycle <n>', 'Goal orchestration cycle number')
    .option('--attach <paths>', 'Comma-separated file paths to attach (screenshots, docs)')
    .option('-e, --edit', 'Open $EDITOR to write the description')
    .action(async (title: string, opts) => {
      if (opts.goalRole !== undefined && opts.goalRole !== 'worker') {
        throw new InvalidArgumentsError('Goal role must be "worker"');
      }

      let description = opts.description;
      if (opts.edit) {
        const { openInEditor, toEditorContent, fromEditorContent } = await import('../editor.js');
        const content = await openInEditor(
          toEditorContent({ title, priority: parseInt(opts.priority, 10), description }),
        );
        const parsed = fromEditorContent(content);
        description = parsed.description;
      }

      const task = await container.taskService.create({
        title,
        description,
        priority: parseInt(opts.priority, 10),
        labels: opts.labels?.split(',').map((s: string) => s.trim()),
        depends_on: opts.dependsOn?.split(',').map((s: string) => s.trim()),
        max_attempts: opts.maxAttempts ? parseInt(opts.maxAttempts, 10) : undefined,
        workspace_mode: opts.workspaceMode,
        assignee: opts.assignee,
        review_criteria: opts.reviewCriteria?.split(',').map((s: string) => s.trim()),
        scope: opts.scope?.split(',').map((s: string) => s.trim()),
        goalId: opts.goalId,
        goalTaskRole: opts.goalRole === 'worker' ? 'worker' : undefined,
        goalCycle: opts.goalCycle ? parseInt(opts.goalCycle, 10) : undefined,
        attachments: opts.attach?.split(',').map((s: string) => s.trim()),
      });

      if (container.context.json) {
        console.log(JSON.stringify(task, null, 2));
      } else if (container.context.quiet) {
        console.log(task.id);
      } else {
        printSuccess(`Created ${task.id} "${task.title}"`);
      }
    });

  // task list
  task
    .command('list')
    .description('List all tasks')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      const tasks = await container.taskService.list(
        opts.status ? { status: opts.status } : undefined,
      );

      if (container.context.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      if (container.context.quiet) {
        tasks.forEach((t) => console.log(t.id));
        return;
      }

      if (tasks.length === 0) {
        console.log(`\n  No tasks. Create one: ${dim('orch task add "Title"')}\n`);
        return;
      }

      const headers = ['STATUS', 'PRI', 'TASK', 'AGENT', 'TIME'];
      const rows = tasks.map((t) => {
        const time = (t.status === 'in_progress' || t.status === 'done') && t.updated_at
          ? formatDurationSince(t.updated_at)
          : dim('—');

        return [
          `${statusIcon(t.status)} ${t.status}`,
          priorityLabel(t.priority),
          t.title.slice(0, 35),
          t.assignee ? agentName(t.assignee) : dim('—'),
          time,
        ];
      });

      console.log();
      printTable(headers, rows);
      const running = tasks.filter((t) => t.status === 'in_progress').length;
      const review = tasks.filter((t) => t.status === 'review').length;
      const done = tasks.filter((t) => t.status === 'done').length;
      console.log(
        `\n  ${tasks.length} tasks${running ? ` · ${running} running` : ''}${review ? ` · ${review} review` : ''}${done ? ` · ${done} done` : ''}\n`,
      );
    });

  // task show
  task
    .command('show <id>')
    .description('Show task details')
    .action(async (id: string) => {
      const t = await container.taskService.get(id);

      if (container.context.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }

      console.log(`\n  ${t.title}`);
      console.log(`  ${'═'.repeat(42)}`);
      console.log();

      const pairs: Array<[string, string]> = [
        ['Status', `${statusIcon(t.status)} ${t.status} · attempt ${t.attempts}/${t.max_attempts}`],
        ['Priority', priorityLabel(t.priority)],
      ];
      if (t.assignee) pairs.push(['Agent', agentName(t.assignee)]);
      if (t.labels.length) pairs.push(['Labels', t.labels.join(', ')]);
      if (t.scope?.length) pairs.push(['Scope', t.scope.join(', ')]);
      if (t.workspace_mode) pairs.push(['Workspace', t.workspace_mode]);
      if (t.workspace) pairs.push(['Path', filePath(t.workspace)]);
      if (t.review_criteria?.length) pairs.push(['Review', t.review_criteria.join(', ')]);
      if (t.feedback) pairs.push(['Feedback', t.feedback]);
      pairs.push(['Created', t.created_at]);

      printKeyValue(pairs);

      if (t.last_error) {
        console.log(`\n  Last Error\n  ${'─'.repeat(42)}`);
        console.log(`  Phase:   ${t.last_error.phase}`);
        console.log(`  Time:    ${t.last_error.at}`);
        if (t.last_error.runId) console.log(`  Run:     ${t.last_error.runId}`);
        if (t.last_error.agentId) console.log(`  Agent:   ${t.last_error.agentId}`);
        for (const line of t.last_error.message.split('\n')) {
          console.log(`  ${line}`);
        }
      }

      if (t.attachments?.length) {
        console.log(`\n  Attachments (${t.attachments.length})\n  ${'─'.repeat(42)}`);
        for (const a of t.attachments) {
          console.log(`    ${filePath(a)}`);
        }
      }

      if (t.description) {
        console.log(`\n  Description\n  ${'─'.repeat(42)}`);
        for (const line of t.description.split('\n')) {
          console.log(`  ${line}`);
        }
      }

      if (t.proof) {
        console.log(`\n  Result\n  ${'─'.repeat(42)}`);
        if (t.proof.branch) console.log(`  Branch:        ${t.proof.branch}`);
        if (t.proof.pr_url) console.log(`  PR:            ${t.proof.pr_url}`);
        if (t.proof.files_changed.length) {
          console.log(`  Files changed:`);
          for (const f of t.proof.files_changed) {
            console.log(`    • ${f}`);
          }
        }
        if (t.proof.test_results) {
          console.log(`  Test results:`);
          for (const line of t.proof.test_results.split('\n')) {
            console.log(`    ${line}`);
          }
        }
        if (t.proof.agent_summary) {
          console.log(`  Agent summary:`);
          for (const line of t.proof.agent_summary.split('\n')) {
            console.log(`    ${line}`);
          }
        }
      }

      if (t.review_results?.length) {
        console.log(`\n  Review Results\n  ${'─'.repeat(42)}`);
        for (const r of t.review_results) {
          const icon = r.passed ? '✓' : '✗';
          console.log(`  ${icon} ${r.criterion}: ${r.passed ? 'passed' : 'failed'}`);
          if (r.output) {
            for (const line of r.output.split('\n')) {
              console.log(`    ${line}`);
            }
          }
        }
      }

      console.log();
    });

  // task edit
  task
    .command('edit <id>')
    .description('Open task in $EDITOR to modify title, priority and description')
    .action(async (id: string) => {
      const existing = await container.taskService.get(id);
      const { openInEditor, toEditorContent, fromEditorContent } = await import('../editor.js');
      const attachmentNote = existing.attachments?.length
        ? `\n# Attachments: ${existing.attachments.join(', ')}`
        : '';
      const initial = toEditorContent({
        title: existing.title,
        priority: existing.priority,
        description: existing.description,
      }) + attachmentNote;

      const content = await openInEditor(initial);
      const parsed = fromEditorContent(content);

      // Only update fields that changed
      const fields: { title?: string; description?: string; priority?: number } = {};
      if (parsed.title && parsed.title !== existing.title) fields.title = parsed.title;
      if (parsed.priority && parsed.priority !== existing.priority) fields.priority = parsed.priority;
      if (parsed.description !== undefined && parsed.description !== existing.description) {
        fields.description = parsed.description ?? '';
      }

      if (Object.keys(fields).length === 0) {
        console.log('  No changes.');
        return;
      }

      const updated = await container.taskService.update(id, fields);
      printSuccess(`Updated ${updated.id} "${updated.title}"`);
    });

  // task assign
  task
    .command('assign <task-id> <agent-id>')
    .description('Assign task to agent')
    .action(async (taskId: string, agentId: string) => {
      const t = await container.taskService.assign(taskId, agentId);
      printSuccess(`Assigned ${t.id} → ${t.assignee ?? agentId}`);
    });

  // task cancel
  task
    .command('cancel <id>')
    .description('Cancel a task')
    .action(async (id: string) => {
      const task = await container.taskService.get(id);

      if (task.status === 'in_progress') {
        // Running task — need orchestrator to kill agent process, clean state, finish run
        const { buildFullContainer } = await import('../../container.js');
        const full = await buildFullContainer(container.context);
        await full.orchestrator.cancelTask(id);
      } else {
        await container.taskService.cancel(id);
      }
      printSuccess(`Cancelled ${id}`);
    });

  // task approve
  task
    .command('approve <id>')
    .description('Approve a task in review')
    .action(async (id: string) => {
      await container.taskService.updateStatus(id, 'done');
      printSuccess(`Approved ${id}`);
    });

  // task reject
  task
    .command('reject <id>')
    .description('Reject a task and send it back for rework')
    .option('-r, --reason <reason>', 'Feedback for the agent explaining what to fix')
    .action(async (id: string, opts) => {
      await container.taskService.reject(id, opts.reason);
      printSuccess(`Rejected ${id} → todo${opts.reason ? ` (reason: ${opts.reason})` : ''}`);
    });

  // task retry
  task
    .command('retry <id>')
    .description('Retry a failed task')
    .action(async (id: string) => {
      await container.taskService.retry(id);
      printSuccess(`Reset ${id} to todo`);
    });
}
