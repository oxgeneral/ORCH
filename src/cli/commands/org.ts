/**
 * `orch org` — pre-built AI company deployment.
 *
 * Subcommands: list, deploy
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import { ORG_TEMPLATES, getOrgTemplateByKey } from '../../domain/org-shop.js';
import { getShopTemplateByKey } from '../../domain/agent-shop.js';
import { printSuccess, printError, printTable, dim } from '../output.js';

export function registerOrgCommand(program: Command, container: LightContainer): void {
  const org = program
    .command('org')
    .description('Pre-built AI companies — deploy a full department with one command');

  // org list — no requireInit(): reads static templates, works before `orch init`
  org
    .command('list')
    .alias('ls')
    .description('List available company templates')
    .action(async () => {
      if (container.context.json) {
        console.log(JSON.stringify(ORG_TEMPLATES, null, 2));
        return;
      }

      console.log();
      const headers = ['KEY', 'NAME', 'AGENTS', 'DESCRIPTION'];
      const rows = ORG_TEMPLATES.map((t) => [
        t.key,
        t.name,
        String(t.agents.length),
        t.description,
      ]);
      printTable(headers, rows);
      console.log();
      console.log(`  ${dim('Deploy:')} orch org deploy <key> --goal "Your objective"`);
      console.log();
    });

  // org deploy
  org
    .command('deploy <template>')
    .description('Deploy a pre-built AI company')
    .option('--goal <goal>', 'Set a goal for the team')
    .action(async (templateKey: string, opts: { goal?: string }) => {
      await container.paths.requireInit();

      const template = getOrgTemplateByKey(templateKey);
      if (!template) {
        printError(
          `Unknown template "${templateKey}"`,
          `Run: orch org list — to see available templates`,
        );
        process.exitCode = 1;
        return;
      }

      // Create agents from shop templates
      const agentIds: string[] = [];
      for (const entry of template.agents) {
        const shopTemplate = getShopTemplateByKey(entry.shop_key);
        if (!shopTemplate) {
          printError(`Agent shop template not found: ${entry.shop_key}`);
          process.exitCode = 1;
          return;
        }

        try {
          const agent = await container.agentService.create({
            name: entry.name,
            adapter: shopTemplate.adapter,
            role: shopTemplate.role,
            model: shopTemplate.model,
            approval_policy: shopTemplate.approval_policy,
            skills: shopTemplate.skills,
          });
          agentIds.push(agent.id);
        } catch (err) {
          printError(
            `Failed to create agent "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
            agentIds.length > 0
              ? `${agentIds.length} agent(s) were already created. Clean up with: orch agent list`
              : undefined,
          );
          process.exitCode = 1;
          return;
        }
      }

      // Create team
      const leadId = agentIds[template.lead_index]!;
      const memberIds = agentIds.filter((id) => id !== leadId);

      const team = await container.teamService.create({
        name: template.name,
        description: template.description,
        lead_agent_id: leadId,
        member_agent_ids: memberIds,
      });

      // Create goal if provided
      let goalId: string | undefined;
      if (opts.goal) {
        const goal = await container.goalService.create({
          title: opts.goal,
          assignee: leadId,
        });
        goalId = goal.id;
      }

      // Output
      if (container.context.json) {
        console.log(JSON.stringify({ team, agentIds, goalId }, null, 2));
        return;
      }

      if (container.context.quiet) {
        console.log(team.id);
        return;
      }

      console.log();
      printSuccess(`Deployed team "${template.name}" — ${template.agents.length} agents`);
      console.log();
      for (let i = 0; i < template.agents.length; i++) {
        const entry = template.agents[i]!;
        const id = agentIds[i]!;
        const isLead = i === template.lead_index;
        const role = isLead ? 'lead' : 'member';
        console.log(`  ${isLead ? '\u2605' : '\u2022'} ${entry.name} ${dim(`(${id}, ${role})`)}`);
      }
      console.log(`\n  Team: ${dim(team.id)}`);

      if (goalId) {
        console.log(`  Goal: ${dim(goalId)} — "${opts.goal}"`);
      }

      console.log();
      console.log(`  ${dim('Next:')} orch run --all --watch`);
      console.log();
    });
}
