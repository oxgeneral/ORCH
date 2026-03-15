/**
 * `orch msg` — inter-agent messaging commands.
 */

import type { Command } from 'commander';
import type { LightContainer } from '../../container.js';
import { printSuccess, printTable, dim, formatDurationSince } from '../output.js';

export function registerMsgCommand(program: Command, container: LightContainer): void {
  const msg = program
    .command('msg')
    .description('Inter-agent messaging');

  msg
    .command('send <to-agent-id> <body>')
    .description('Send a direct message to an agent')
    .option('-s, --subject <subject>', 'Message subject')
    .option('--from <agent-id>', 'Sender agent ID (default: cli)')
    .option('--ttl <ms>', 'TTL in milliseconds')
    .option('--reply-to <msg-id>', 'Reply to a message')
    .action(async (toAgentId: string, body: string, opts) => {

      const messages = await container.messageService.send({
        channel: 'direct',
        from_agent_id: opts.from ?? 'cli',
        to_agent_id: toAgentId,
        subject: opts.subject ?? '',
        body,
        ttl_ms: opts.ttl ? parseInt(opts.ttl, 10) : undefined,
        reply_to: opts.replyTo,
      });
      if (container.context.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else if (container.context.quiet) {
        console.log(messages[0]?.id);
      } else {
        printSuccess(`Message sent: ${messages[0]?.id} → ${toAgentId}`);
      }
    });

  msg
    .command('broadcast <body>')
    .description('Broadcast a message to all agents (or team members)')
    .option('-s, --subject <subject>', 'Message subject')
    .option('--from <agent-id>', 'Sender agent ID (default: cli)')
    .option('--team <team-id>', 'Limit broadcast to team members')
    .option('--ttl <ms>', 'TTL in milliseconds')
    .action(async (body: string, opts) => {

      const messages = await container.messageService.send({
        channel: 'broadcast',
        from_agent_id: opts.from ?? 'cli',
        subject: opts.subject ?? '',
        body,
        ttl_ms: opts.ttl ? parseInt(opts.ttl, 10) : undefined,
        team_id: opts.team,
      });
      if (container.context.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else if (container.context.quiet) {
        console.log(messages.map((m) => m.id).join('\n'));
      } else {
        printSuccess(`Broadcast sent to ${messages.length} agent(s)`);
      }
    });

  msg
    .command('inbox <agent-id>')
    .description('Show pending messages for an agent')
    .action(async (agentId: string) => {

      const pending = await container.messageService.listPendingForAgent(agentId);
      if (container.context.json) {
        console.log(JSON.stringify(pending, null, 2));
        return;
      }
      if (pending.length === 0) {
        console.log(dim('\n  No pending messages.\n'));
        return;
      }
      console.log();
      for (const m of pending) {
        console.log(`  ${dim(m.id)} from ${m.from_agent_id}${m.subject ? ` — ${m.subject}` : ''}`);
        console.log(`  ${m.body}`);
        console.log();
      }
    });

  msg
    .command('list')
    .description('List all messages')
    .option('--agent <agent-id>', 'Filter by agent (sent or received)')
    .action(async (opts) => {

      let messages;
      if (opts.agent) {
        messages = await container.messageService.listForAgent(opts.agent);
      } else {
        messages = await container.messageService.listAll();
      }
      if (container.context.json) {
        console.log(JSON.stringify(messages, null, 2));
        return;
      }
      if (messages.length === 0) {
        console.log(dim('\n  No messages.\n'));
        return;
      }
      const headers = ['ID', 'FROM', 'TO', 'CHANNEL', 'STATUS', 'SENT'];
      const rows = messages.map((m) => [
        m.id,
        m.from_agent_id,
        m.to_agent_id ?? '*',
        m.channel,
        m.status,
        formatDurationSince(m.created_at),
      ]);
      console.log();
      printTable(headers, rows);
      console.log(`\n  ${messages.length} message(s)\n`);
    });
}
