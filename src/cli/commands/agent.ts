/**
 * `orch agent` command group.
 *
 * Subcommands: add, list, status, remove, disable, enable
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import {
  statusIcon,
  printSuccess,
  printTable,
  printKeyValue,
  formatTokens,
  dim,
  agentName,
} from '../output.js';
import { openInEditor, agentToEditorContent, agentFromEditorContent } from '../editor.js';

export function registerAgentCommand(program: Command, container: LightContainer): void {
  const agent = program
    .command('agent')
    .description('Manage agents');

  // agent add
  agent
    .command('add <name>')
    .description('Add a new agent')
    .requiredOption('--adapter <adapter>', 'Adapter type: claude, shell, codex, cursor')
    .option('--role <role>', 'Agent role description')
    .option('--command <cmd>', 'Shell command (for shell adapter)')
    .option('--model <model>', 'Model name (for AI adapters)')
    .option('--max-turns <n>', 'Max turns per run')
    .option('--timeout <ms>', 'Timeout in ms')
    .option('--approval-policy <policy>', 'suggest|auto|manual')
    .option('--workspace-mode <mode>', 'shared|worktree|isolated')
    .option('--skills <skills>', 'Comma-separated list of agent skills')
    .option('-e, --edit', 'Open $EDITOR to write the role description')
    .action(async (name: string, opts) => {
      await container.paths.requireInit();

      let role = opts.role;

      if (opts.edit) {
        const initial = agentToEditorContent({ name, model: opts.model, role });
        const edited = await openInEditor(initial);
        const parsed = agentFromEditorContent(edited);
        if (parsed.name) name = parsed.name;
        if (parsed.model) opts.model = parsed.model;
        if (parsed.role) role = parsed.role;
      }

      const a = await container.agentService.create({
        name,
        adapter: opts.adapter,
        role,
        command: opts.command,
        model: opts.model,
        max_turns: opts.maxTurns ? parseInt(opts.maxTurns, 10) : undefined,
        timeout_ms: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
        approval_policy: opts.approvalPolicy,
        workspace_mode: opts.workspaceMode,
        skills: opts.skills ? opts.skills.split(',').map((s: string) => s.trim()) : undefined,
      });

      if (container.context.json) {
        console.log(JSON.stringify(a, null, 2));
      } else if (container.context.quiet) {
        console.log(a.id);
      } else {
        printSuccess(`Added agent ${agentName(a.name)} (${a.adapter}) → ${a.id}`);
      }
    });

  // agent list
  agent
    .command('list')
    .description('List all agents')
    .action(async () => {
      await container.paths.requireInit();

      const agents = await container.agentService.list();

      if (container.context.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }

      if (container.context.quiet) {
        agents.forEach((a) => console.log(a.id));
        return;
      }

      if (agents.length === 0) {
        console.log(`\n  No agents. Add one: ${dim('orch agent add <name> --adapter claude')}\n`);
        return;
      }

      const headers = ['STATUS', 'AGENT', 'ADAPTER', 'TASK', 'TIME'];
      const rows = agents.map((a) => [
        `${statusIcon(a.status)} ${a.status}`,
        agentName(a.name),
        a.adapter,
        a.current_task ?? dim('—'),
        dim('—'),
      ]);

      console.log();
      printTable(headers, rows);
      const running = agents.filter((a) => a.status === 'running').length;
      console.log(
        `\n  ${agents.length} agents · ${running} running · ${formatTokens(agents.reduce((sum, a) => sum + (a.stats.tokens_used ?? 0), 0))} tokens total\n`,
      );
    });

  // agent status
  agent
    .command('status <id>')
    .description('Show agent details')
    .action(async (id: string) => {
      await container.paths.requireInit();

      const a = await container.agentService.get(id);

      if (container.context.json) {
        console.log(JSON.stringify(a, null, 2));
        return;
      }

      console.log(`\n  ${a.name}`);
      console.log(`  ${'═'.repeat(42)}`);
      console.log();

      const pairs: Array<[string, string]> = [
        ['Adapter', `${a.adapter}${a.config.model ? ` (${a.config.model})` : ''}`],
        ['Status', `${statusIcon(a.status)} ${a.status}`],
        ['Policy', a.config.approval_policy ?? 'auto'],
      ];
      if (a.current_task) pairs.push(['Task', a.current_task]);
      if (a.role) pairs.push(['Role', a.role]);
      if (a.config.skills?.length) pairs.push(['Skills', a.config.skills.join(', ')]);

      printKeyValue(pairs);

      console.log(`\n  Stats\n  ${'─'.repeat(42)}`);
      printKeyValue([
        ['Tasks completed', String(a.stats.tasks_completed)],
        ['Tasks failed', String(a.stats.tasks_failed)],
        ['Total runs', String(a.stats.total_runs)],
        ['Tokens used', formatTokens(a.stats.tokens_used ?? 0)],
      ]);

      console.log();
    });

  // agent edit
  agent
    .command('edit <id>')
    .description('Edit an agent in $EDITOR')
    .action(async (id: string) => {
      await container.paths.requireInit();

      const a = await container.agentService.get(id);
      const initial = agentToEditorContent({
        name: a.name,
        model: a.config.model,
        role: a.role,
      });

      const edited = await openInEditor(initial);
      const parsed = agentFromEditorContent(edited);

      const updated = await container.agentService.update(id, {
        name: parsed.name,
        role: parsed.role,
        model: parsed.model,
      });

      if (container.context.json) {
        console.log(JSON.stringify(updated, null, 2));
      } else if (container.context.quiet) {
        console.log(updated.id);
      } else {
        printSuccess(`Updated agent ${agentName(updated.name)} (${updated.id})`);
      }
    });

  // agent remove
  agent
    .command('remove <id>')
    .description('Remove an agent')
    .action(async (id: string) => {
      await container.paths.requireInit();
      await container.agentService.remove(id);
      printSuccess(`Removed agent ${id}`);
    });

  // agent disable
  agent
    .command('disable <id>')
    .description('Disable an agent')
    .action(async (id: string) => {
      await container.paths.requireInit();
      await container.agentService.disable(id);
      printSuccess(`Disabled agent ${id}`);
    });

  // agent enable
  agent
    .command('enable <id>')
    .description('Enable an agent')
    .action(async (id: string) => {
      await container.paths.requireInit();
      await container.agentService.enable(id);
      printSuccess(`Enabled agent ${id}`);
    });

  // agent autonomous
  agent
    .command('autonomous <id>')
    .description('Toggle autonomous mode for an agent')
    .option('--on', 'Enable autonomous mode')
    .option('--off', 'Disable autonomous mode')
    .action(async (id: string, opts: { on?: boolean; off?: boolean }) => {
      await container.paths.requireInit();
      const current = await container.agentService.get(id);
      const enable = opts.on ? true : opts.off ? false : !current.autonomous;
      const a = await container.agentService.setAutonomous(id, enable);

      if (container.context.json) {
        console.log(JSON.stringify(a, null, 2));
      } else if (container.context.quiet) {
        console.log(a.id);
      } else {
        printSuccess(`Autonomous mode ${enable ? 'enabled' : 'disabled'} for agent ${agentName(a.name)} (${a.id})`);
      }
    });
}
