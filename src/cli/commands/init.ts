/**
 * `orch init` command.
 *
 * Creates .orchestry/ scaffold in the current directory.
 */

import type { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Paths } from '../../infrastructure/storage/paths.js';
import { ensureDir, pathExists } from '../../infrastructure/storage/fs-utils.js';
import { writeYaml, atomicWrite } from '../../infrastructure/storage/fs-utils.js';
import { DEFAULT_CONFIG } from '../../domain/config.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../../infrastructure/template/template-engine.js';
import { getDefaultAgents } from '../../domain/default-agents.js';
import { printSuccess, printWarning, dim } from '../output.js';

/** Run init logic directly (used by auto-init on bare `orch`). */
export async function runInit(opts: { name?: string } = {}): Promise<void> {
  const projectRoot = process.cwd();
  const paths = new Paths(projectRoot);

  if (await pathExists(paths.root)) {
    printWarning('Already initialized');
    return;
  }

  // Create directory structure (all siblings, no deps — parallel)
  await Promise.all([
    ensureDir(paths.tasksDir),
    ensureDir(paths.agentsDir),
    ensureDir(paths.goalsDir),
    ensureDir(paths.runsDir),
    ensureDir(paths.templatesDir),
    ensureDir(paths.logsDir),
  ]);

  // Write config + static files (independent — parallel)
  const config = { ...DEFAULT_CONFIG };
  config.project.name = opts.name ?? path.basename(projectRoot);

  const gitignoreContent = [
    '# Runtime state',
    'state.json',
    '*.lock',
    '',
    '# Logs and runs',
    'runs/',
    'logs/',
    '',
    '# Agent workspaces',
    'workspaces/',
  ].join('\n') + '\n';

  const excludeContent = [
    '.orchestry',
    'node_modules',
    '.env',
    '.env.*',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '*.pyc',
    '.venv',
  ].join('\n') + '\n';

  const defaultAgents = getDefaultAgents();

  await Promise.all([
    writeYaml(paths.configPath, config),
    atomicWrite(paths.gitignorePath, gitignoreContent),
    atomicWrite(paths.workspaceExcludePath, excludeContent),
    atomicWrite(paths.defaultTemplatePath(), DEFAULT_PROMPT_TEMPLATE),
    ...defaultAgents.map((agent) => writeYaml(paths.agentPath(agent.id), agent)),
  ]);

  // Ensure .orchestry is in root .gitignore (prevents recursive worktrees)
  await ensureRootGitignore(projectRoot);

  // Output
  console.log();
  printSuccess('initialized');
  console.log();
  console.log(`  Created ${dim('.orchestry/')}`);
  console.log(`  ${dim('├──')} config.yml`);
  console.log(`  ${dim('├──')} tasks/`);
  console.log(`  ${dim('├──')} agents/`);
  for (const agent of defaultAgents) {
    console.log(`  ${dim('│   └──')} ${agent.id}.yml ${dim(`(${agent.name})`)}`);
  }
  console.log(`  ${dim('├──')} templates/default.md`);
  console.log(`  ${dim('└──')} .gitignore`);
  console.log();
}

/**
 * Ensure `.orchestry` is listed in the project's root `.gitignore`.
 * Appends the entry if missing — avoids recursive worktree copies.
 */
async function ensureRootGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    // Already present (as a whole line)
    if (content.split('\n').some((line) => line.trim() === '.orchestry')) return;
    // Append
    const separator = content.endsWith('\n') ? '' : '\n';
    await fs.appendFile(gitignorePath, `${separator}\n# Orchestry state\n.orchestry\n`);
  } catch {
    // No .gitignore yet — create one
    await atomicWrite(gitignorePath, '# Orchestry state\n.orchestry\n');
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize .orchestry/ in the current directory')
    .option('--name <name>', 'Project name')
    .action(async (opts: { name?: string }) => {
      await runInit(opts);
      console.log(`  Next: ${dim('orch task add "Create backend agent" --assignee agt_creator')}`);
      console.log();
    });
}
