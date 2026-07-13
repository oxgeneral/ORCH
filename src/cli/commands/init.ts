/**
 * `orch init` command.
 *
 * Creates .orchestry/ scaffold in the current directory.
 */

import type { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Paths } from '../../infrastructure/storage/paths.js';
import { ensureDir, pathExists } from '../../infrastructure/storage/fs-utils.js';
import { writeYaml, atomicWrite } from '../../infrastructure/storage/fs-utils.js';
import { DEFAULT_CONFIG } from '../../domain/config.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../../infrastructure/template/template-engine.js';
import { getDefaultAgents } from '../../domain/default-agents.js';
import { SUPPORTED_ADAPTERS, isAdapterKind } from '../../domain/model-tiers.js';
import { printSuccess, printWarning, printError, dim } from '../output.js';

const execFileAsync = promisify(execFileCb);

/** Run init logic directly (used by auto-init on bare `orch`). */
export async function runInit(opts: { name?: string; adapter?: string } = {}): Promise<void> {
  const projectRoot = process.cwd();
  const paths = new Paths(projectRoot);

  if (await pathExists(paths.root)) {
    printWarning('Already initialized');
    return;
  }

  // Detect / select default adapter
  const chosenAdapter = opts.adapter ?? await detectAndSelectAdapter();

  // Create directory structure (all siblings, no deps — parallel)
  await Promise.all([
    ensureDir(paths.tasksDir),
    ensureDir(paths.agentsDir),
    ensureDir(paths.goalsDir),
    ensureDir(paths.runsDir),
    ensureDir(paths.templatesDir),
    ensureDir(paths.logsDir),
  ]);

  // Ensure git repo exists (init if needed) before writing config
  const gitAvailable = await ensureGitRepo(projectRoot);

  // Write config + static files (independent — parallel)
  const config = structuredClone(DEFAULT_CONFIG);
  config.project.name = opts.name ?? path.basename(projectRoot);
  config.defaults.agent.adapter = chosenAdapter;

  // Fall back to shared mode when git is not available
  if (!gitAvailable) {
    config.defaults.agent.workspace_mode = 'shared';
  }

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

  const defaultAgents = getDefaultAgents(chosenAdapter);

  await Promise.all([
    writeYaml(paths.configPath, config),
    atomicWrite(paths.gitignorePath, gitignoreContent),
    atomicWrite(paths.workspaceExcludePath, excludeContent),
    atomicWrite(paths.defaultTemplatePath(), DEFAULT_PROMPT_TEMPLATE),
    ...defaultAgents.map((agent) => writeYaml(paths.agentPath(agent.id), agent)),
  ]);

  // Ensure .orchestry is in root .gitignore (prevents recursive worktrees)
  await ensureRootGitignore(projectRoot);

  // Ensure at least one commit exists (required for git worktree)
  if (gitAvailable) {
    await ensureGitCommit(projectRoot);
  }

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

// ── Adapter detection ──

interface AdapterCheckResult {
  name: string;
  ok: boolean;
  version?: string;
}

/**
 * Detect available adapters and let the user choose one.
 * - If only one adapter is available → auto-select.
 * - If multiple → prompt interactively (TTY) or default to first found.
 * - If none found → default to 'claude'.
 */
async function detectAndSelectAdapter(): Promise<string> {
  // Check all adapters in parallel via --version
  const checks = await Promise.all(
    SUPPORTED_ADAPTERS.filter((a) => a !== 'shell').map(async (name): Promise<AdapterCheckResult> => {
      // Only probe cursor-agent (not 'agent' — too generic, causes false positives)
      const cmdsToTry =
        name === 'cursor' ? ['cursor-agent'] :
        name === 'antigravity' ? ['agy'] :
        [name];
      for (const cmd of cmdsToTry) {
        try {
          const { stdout } = await execFileAsync(cmd, ['--version'], { timeout: 5_000 });
          return { name, ok: true, version: stdout.trim().split('\n')[0] };
        } catch { /* try next */ }
      }
      return { name, ok: false };
    }),
  );

  const available = checks.filter((c) => c.ok);

  if (available.length === 0) {
    console.log(`  ${dim('No AI adapters detected — defaulting to claude')}`);
    return 'claude';
  }

  if (available.length === 1) {
    console.log(`  ${dim(`Detected: ${available[0]!.name}`)} ${dim(available[0]!.version ? `(${available[0]!.version})` : '')}`);
    return available[0]!.name;
  }

  // Multiple adapters available — prompt if TTY
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return available[0]!.name;
  }

  console.log();
  console.log('  Available adapters:');
  for (let i = 0; i < available.length; i++) {
    const c = available[i]!;
    console.log(`    ${i + 1}) ${c.name} ${dim(c.version ?? '')}`);
  }
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`  Choose default adapter [1-${available.length}]: `, resolve);
    });
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < available.length) {
      return available[idx]!.name;
    }
    return available[0]!.name;
  } finally {
    rl.close();
  }
}

/**
 * Ensure the project directory is a git repository.
 * Runs `git init` silently if not. Returns false only if git is unavailable.
 */
async function ensureGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot });
    return true;
  } catch {
    // Not a git repo — try to initialize
    try {
      await execFileAsync('git', ['init'], { cwd: projectRoot });
      return true;
    } catch {
      // git binary not available
      return false;
    }
  }
}

/**
 * Ensure at least one commit exists (required for `git worktree add`).
 * Creates an initial commit silently if the repo has no commits.
 */
async function ensureGitCommit(projectRoot: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
    // Has commits — nothing to do
  } catch {
    // No commits — create initial commit
    try {
      await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: projectRoot });
    } catch {
      // Commit may fail (no user.name/email configured) — non-fatal
    }
  }
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
    .option('--adapter <adapter>', 'Default agent adapter (claude, opencode, codex, cursor, pi, grok, antigravity, shell)')
    .action(async (opts: { name?: string; adapter?: string }) => {
      if (opts.adapter && !isAdapterKind(opts.adapter)) {
        printError(`Unknown adapter "${opts.adapter}"`, `Supported: ${SUPPORTED_ADAPTERS.join(', ')}`);
        process.exitCode = 2;
        return;
      }
      await runInit(opts);
      console.log(`  Next: ${dim('orch task add "Create backend agent" --assignee agt_creator')}`);
      console.log();
    });
}
