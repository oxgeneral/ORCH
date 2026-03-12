/**
 * `orch team` — team management commands.
 */

import type { Command } from 'commander';
import type { Container } from '../../container.js';
import { printSuccess, printTable, printKeyValue, dim } from '../output.js';

export function registerTeamCommand(program: Command, container: Container): void {
  const team = program
    .command('team')
    .description('Manage agent teams');

  team
    .command('create <name>')
    .description('Create a new team')
    .requiredOption('--lead <agent-id>', 'Lead agent ID')
    .option('--members <ids>', 'Comma-separated member agent IDs')
    .option('-d, --description <desc>', 'Team description')
    .option('--no-auto-claim', 'Disable auto-claiming')
    .action(async (name: string, opts) => {
      await container.paths.requireInit();
      const t = await container.teamService.create({
        name,
        description: opts.description,
        lead_agent_id: opts.lead,
        member_agent_ids: opts.members?.split(',').map((s: string) => s.trim()),
        config: { auto_claim: opts.autoClaim !== false },
      });
      if (container.context.json) {
        console.log(JSON.stringify(t, null, 2));
      } else if (container.context.quiet) {
        console.log(t.id);
      } else {
        printSuccess(`Created team "${t.name}" → ${t.id}`);
      }
    });

  team
    .command('list')
    .description('List all teams')
    .action(async () => {
      await container.paths.requireInit();
      const teams = await container.teamService.list();
      if (container.context.json) {
        console.log(JSON.stringify(teams, null, 2));
        return;
      }
      if (teams.length === 0) {
        console.log(dim(`\n  No teams. Create one: orch team create <name> --lead <agent-id>\n`));
        return;
      }
      const headers = ['ID', 'NAME', 'STATUS', 'LEAD', 'MEMBERS', 'POOL'];
      const rows = teams.map((t) => [
        t.id,
        t.name,
        t.status,
        t.lead_agent_id,
        String(t.members.length),
        String(t.task_pool.length),
      ]);
      console.log();
      printTable(headers, rows);
      console.log();
    });

  team
    .command('show <id>')
    .description('Show team details')
    .action(async (id: string) => {
      await container.paths.requireInit();
      const t = await container.teamService.get(id);
      if (container.context.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }
      console.log();
      printKeyValue([
        ['ID', t.id],
        ['Name', t.name],
        ['Status', t.status],
        ['Lead', t.lead_agent_id],
        ['Members', t.members.map((m) => `${m.agent_id} (${m.role})`).join(', ')],
        ['Pool', t.task_pool.length > 0 ? t.task_pool.join(', ') : dim('empty')],
        ['Auto-claim', String(t.config.auto_claim)],
        ['Created', t.created_at],
      ]);
      console.log();
    });

  team
    .command('join <team-id> <agent-id>')
    .description('Add an agent to a team')
    .action(async (teamId: string, agentId: string) => {
      await container.paths.requireInit();
      await container.teamService.join(teamId, agentId);
      printSuccess(`Agent ${agentId} joined team ${teamId}`);
    });

  team
    .command('leave <team-id> <agent-id>')
    .description('Remove an agent from a team')
    .action(async (teamId: string, agentId: string) => {
      await container.paths.requireInit();
      await container.teamService.leave(teamId, agentId);
      printSuccess(`Agent ${agentId} left team ${teamId}`);
    });

  team
    .command('add-task <team-id> <task-id>')
    .description('Add a task to the team pool')
    .action(async (teamId: string, taskId: string) => {
      await container.paths.requireInit();
      await container.teamService.addTask(teamId, taskId);
      printSuccess(`Task ${taskId} added to team ${teamId} pool`);
    });

  team
    .command('set-lead <team-id> <agent-id>')
    .description('Transfer team lead to another member')
    .action(async (teamId: string, agentId: string) => {
      await container.paths.requireInit();
      await container.teamService.setLead(teamId, agentId);
      printSuccess(`${agentId} is now lead of team ${teamId}`);
    });

  team
    .command('disband <id>')
    .description('Disband a team')
    .action(async (id: string) => {
      await container.paths.requireInit();
      await container.teamService.disband(id);
      printSuccess(`Team ${id} disbanded`);
    });
}
