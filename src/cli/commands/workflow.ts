import path from 'node:path';
import type { Command } from 'commander';
import type { Container } from '../../container.js';

export function registerWorkflowCommand(program: Command, container: Container): void {
  const workflow = program.command('workflow').description('Recoverable Codex-Fable-Opus workflow');
  workflow.command('start <objective>').description('Start and run the workflow in the foreground').option('--pipeline <name>', 'Pipeline name', 'codex-fable-opus').option('--check <command...>', 'Mandatory deterministic checks').option('--allow <path...>', 'Allowed file scope').option('--post-review <mode>', 'risk_based|always|never', 'risk_based').action(async (objective: string, options: { pipeline: string; check?: string[]; allow?: string[]; postReview: string }) => {
    if (options.pipeline !== 'codex-fable-opus') throw new Error(`Unsupported pipeline: ${options.pipeline}`);
    if (!['risk_based', 'always', 'never'].includes(options.postReview)) throw new Error('Invalid --post-review mode');
    const id = await container.workflowEngine.start({ objective, allowed_file_scope: options.allow, required_checks: options.check, config: { post_review: options.postReview as 'risk_based' | 'always' | 'never' } });
    console.log(id); // Printed before foreground execution so the job remains discoverable after interruption.
    const result = await container.workflowEngine.run(id); if (result.phase === 'failed') process.exitCode = 1;
  });
  workflow.command('status <job-id>').description('Show workflow status').action(async (id: string) => { const [job, sessions] = await Promise.all([container.workflowStore.readJob(id), container.workflowStore.readSessions(id)]); if (!job || !sessions) throw new Error(`Workflow job not found: ${id}`); print(container, { job_id: id, phase: job.phase, current_agent: agentFor(job.phase), revision: job.revision, fable_calls: `${job.fable_pre_opus_calls}/3 pre-Opus, ${job.fable_post_opus_calls} post-Opus`, branch: job.branch, commit: job.current_commit, last_verdict: job.last_verdict, blocker: job.blocker, next_action: job.next_action, usage: sessions.usage }); });
  workflow.command('pause <job-id>').description('Pause a workflow').action(async (id: string) => { print(container, await container.workflowEngine.pause(id)); });
  workflow.command('resume <job-id>').description('Resume and run a workflow in the foreground').action(async (id: string) => { const result = await container.workflowEngine.resume(id); print(container, result); if (result.phase === 'failed') process.exitCode = 1; });
  workflow.command('cancel <job-id>').description('Cancel a workflow').action(async (id: string) => { print(container, await container.workflowEngine.cancel(id)); });
  workflow.command('logs <job-id>').description('Show durable workflow events').action(async (id: string) => { const events = await container.workflowStore.readEvents(id); if (container.context.json) console.log(JSON.stringify(events, null, 2)); else for (const event of events) console.log(`${event.timestamp} ${event.type} ${JSON.stringify(event.data)}`); });
  workflow.command('artifacts <job-id>').description('List canonical workflow artifacts').action(async (id: string) => { const passport = await container.workflowStore.readPassport(id); if (!passport) throw new Error(`Workflow job not found: ${id}`); const root = path.join(container.context.projectRoot, '.orchestry', 'workflows', id, 'artifacts'); print(container, passport.artifacts.map((item) => ({ ...item, path: path.join(root, item.filename) }))); });
  workflow.command('doctor').description('Check native workflow CLIs').action(async () => { const checks = await Promise.all([container.adapterRegistry.require('codex').test(), container.adapterRegistry.require('claude').test()]); const codex = checks[0]!; const claude = checks[1]!; const result = { codex: codex.ok ? codex.version : 'unavailable', claude: claude.ok ? claude.version : 'unavailable', session_resume: 'Persisted passport fallback; native resume syntax is not used because capability was not verified.' }; print(container, result); });
}

function print(container: Container, value: unknown): void { console.log(JSON.stringify(value, null, container.context.json ? 2 : 2)); }
function agentFor(phase: string): string | null { if (phase.startsWith('codex')) return 'codex'; if (phase.startsWith('fable')) return 'fable'; if (phase === 'opus_execution') return 'opus'; return null; }
