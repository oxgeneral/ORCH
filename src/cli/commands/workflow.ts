import fs from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { runNativeRoleWorkflow } from '../../infrastructure/workflow/native-role-workflow.js';

interface WorkflowOptions {
  supervisor: string;
  supervisorModel: string;
  implementer: string;
  implementerModel: string;
  reviewer: string;
  reviewerModel: string;
  adviser?: string;
  adviserModel?: string;
  objectiveFile?: string;
  maxAttempts: string;
  yes?: boolean;
}

export function registerWorkflowCommand(program: Command): void {
  program
    .command('workflow')
    .description('Run a confirmed Supervisor, Implementer, and Reviewer workflow')
    .requiredOption('--supervisor <cli>', 'Supervisor CLI (codex)')
    .requiredOption('--supervisor-model <model>', 'Supervisor model')
    .requiredOption('--implementer <cli>', 'Implementer CLI (claude)')
    .requiredOption('--implementer-model <model>', 'Implementer model')
    .requiredOption('--reviewer <cli>', 'Reviewer CLI (codex)')
    .requiredOption('--reviewer-model <model>', 'Reviewer model')
    .option('--adviser <cli>', 'Optional Adviser CLI (claude)')
    .option('--adviser-model <model>', 'Optional Adviser model')
    .option('--objective-file <path>', 'Read the objective from a protected file instead of stdin')
    .option('--max-attempts <count>', 'Maximum Supervisor and Reviewer attempts', '1')
    .option('--yes', 'Confirm the printed workflow summary')
    .action(async (options: WorkflowOptions) => {
      if (Boolean(options.adviser) !== Boolean(options.adviserModel)) {
        throw new Error('--adviser and --adviser-model must be supplied together');
      }
      if (!options.objectiveFile && !options.yes) {
        throw new Error('A workflow objective read from stdin requires --yes; use --objective-file for interactive confirmation');
      }
      const objective = options.objectiveFile ? undefined : await readStdin();
      const state = await runNativeRoleWorkflow(process.cwd(), {
        objective,
        objectiveFile: options.objectiveFile,
        confirmed: Boolean(options.yes),
        supervisor: { cli: options.supervisor as 'codex', model: options.supervisorModel },
        adviser: options.adviser ? { cli: options.adviser as 'claude', model: options.adviserModel! } : null,
        implementer: { cli: options.implementer as 'claude', model: options.implementerModel },
        reviewer: { cli: options.reviewer as 'codex', model: options.reviewerModel },
        maxAttempts: Number(options.maxAttempts),
        onSummary: (summary) => console.log(JSON.stringify({ type: 'workflow_summary', ...summary as object })),
        confirm: async () => {
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try {
            const answer = (await prompt.question('Start this workflow? [y/N] ')).trim().toLowerCase();
            return answer === 'y' || answer === 'yes';
          } finally {
            prompt.close();
          }
        },
        onCheck: (check) => console.log(JSON.stringify({ type: 'workflow_check', ...check })),
      });
      console.log(JSON.stringify(state));
    });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 128_000) throw new Error('Workflow objective exceeds 128000 bytes');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
