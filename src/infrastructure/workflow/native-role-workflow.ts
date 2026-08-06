import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  NativeRoleWorkflowState,
  WorkflowBinding,
  WorkflowRole,
} from '../../domain/native-role-workflow.js';
import { validateWorkflowBindings } from '../../domain/native-role-workflow.js';

const execFileAsync = promisify(execFile);
const MAX_OBJECTIVE_BYTES = 128_000;
const MAX_PROCESS_OUTPUT_BYTES = 1_000_000;

export interface NativeRoleWorkflowOptions {
  objective?: string;
  objectiveFile?: string;
  confirmed: boolean;
  supervisor: WorkflowBinding;
  adviser: WorkflowBinding | null;
  implementer: WorkflowBinding;
  reviewer: WorkflowBinding;
  maxAttempts: number;
  onSummary?: (summary: unknown) => void;
  confirm?: () => Promise<boolean>;
  onCheck?: (check: { command: string; status: string }) => void;
}

interface RepositorySnapshot {
  root: string;
  targetBranch: string;
  targetCommit: string;
  packageManager: 'npm';
  scripts: Array<{ name: string; value: string }>;
  lockfile: string;
}

export async function runNativeRoleWorkflow(
  cwd: string,
  options: NativeRoleWorkflowOptions,
): Promise<NativeRoleWorkflowState> {
  const objective = await readObjective(options);
  const roles = {
    supervisor: options.supervisor,
    adviser: options.adviser,
    implementer: options.implementer,
    reviewer: options.reviewer,
  };
  validateWorkflowBindings(roles);
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 3) {
    throw new Error('max-attempts must be between 1 and 3');
  }

  const repository = await inspectRepository(cwd);
  await assertExecutables(roles);
  const id = `wf_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const workflowRoot = path.join(repository.root, '.orchestry', 'workflows', id);
  const worktree = path.join(workflowRoot, 'worktree');
  const workflowBranch = `orchestry/workflow-${id.slice(3)}`;
  const state: NativeRoleWorkflowState = {
    schema_version: 1,
    id,
    phase: 'created',
    target_branch: repository.targetBranch,
    target_commit: repository.targetCommit,
    workflow_branch: workflowBranch,
    worktree,
    roles,
    attempts: [],
    checks: [],
    implementation_commit: null,
    diff_hash: null,
    merge_commit: null,
    error: null,
  };
  await fs.mkdir(workflowRoot, { recursive: true, mode: 0o700 });
  await writeState(workflowRoot, state);

  options.onSummary?.({
    workflow_id: id,
    objective: { supplied: true, bytes: Buffer.byteLength(objective) },
    target: { branch: repository.targetBranch, commit: repository.targetCommit },
    roles,
    checks: ['npm ci --ignore-scripts --no-audit --no-fund', ...repository.scripts.map((script) => `npm run --ignore-scripts ${script.name}`), 'git diff --check'],
    adviser: { enabled: roles.adviser !== null, max_calls: roles.adviser ? 1 : 0 },
    implementer_permissions: 'autonomous writes limited to the dedicated Git worktree',
    max_attempts: { supervisor: options.maxAttempts, adviser: roles.adviser ? 1 : 0, implementer: 1, reviewer: options.maxAttempts },
  });

  const accepted = options.confirmed || await options.confirm?.() || false;
  if (!accepted) {
    state.phase = 'cancelled';
    await writeState(workflowRoot, state);
    return state;
  }

  let worktreeCreated = false;
  try {
    await assertTargetUnchanged(repository);
    await git(repository.root, ['worktree', 'add', '-b', workflowBranch, worktree, repository.targetCommit]);
    worktreeCreated = true;
    state.phase = 'running';
    await writeState(workflowRoot, state);

    const supervisor = await runRoleWithRetries({
      role: 'supervisor', binding: roles.supervisor, cwd: repository.root,
      prompt: JSON.stringify({ role: 'supervisor', objective, task: 'Return JSON with a nonempty plan string.' }),
      attempts: options.maxAttempts, state, workflowRoot,
    });
    const plan = supervisor['plan'] as string;

    let advice: string | null = null;
    if (roles.adviser) {
      const adviser = await runRoleWithRetries({
        role: 'adviser', binding: roles.adviser, cwd: repository.root,
        prompt: JSON.stringify({ role: 'adviser', objective, plan, task: 'Return JSON with an advice string. Do not modify files.' }),
        attempts: 1, state, workflowRoot,
      });
      advice = adviser['advice'] as string;
    }

    const implementerPrompt = JSON.stringify({
      role: 'implementer', objective, plan, advice,
      task: 'Implement the objective in this Git worktree, run no network commands, and commit all changes. Return JSON with status "completed".',
    });
    const implementation = await runRoleWithRetries({
      role: 'implementer', binding: roles.implementer, cwd: worktree,
      prompt: implementerPrompt, attempts: 1, state, workflowRoot,
    });
    if (implementation['status'] !== 'completed') throw new Error('Implementer did not report completed status');

    await assertClean(worktree, 'Implementation worktree');
    state.implementation_commit = await gitOutput(worktree, ['rev-parse', 'HEAD']);
    if (state.implementation_commit === repository.targetCommit) throw new Error('Implementer produced no commit');
    if (!await gitSucceeds(worktree, ['merge-base', '--is-ancestor', repository.targetCommit, state.implementation_commit])) {
      throw new Error('Implementation commit does not descend from the recorded target');
    }
    await assertFrozenManifest(worktree, repository);
    const diff = await gitOutput(worktree, ['diff', '--binary', `${repository.targetCommit}..${state.implementation_commit}`]);
    if (!diff.trim()) throw new Error('Implementer produced an empty diff');
    state.diff_hash = createHash('sha256').update(diff).digest('hex');

    state.phase = 'checking';
    await writeState(workflowRoot, state);
    const installCommand = 'npm ci --ignore-scripts --no-audit --no-fund';
    const install = await runCheck('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], worktree, installCommand);
    state.checks.push(install);
    options.onCheck?.({ command: install.command, status: install.status });
    await writeState(workflowRoot, state);
    if (install.status !== 'passed') throw new Error(`Required check failed: ${installCommand}`);
    for (const script of repository.scripts) {
      const command = `npm run --ignore-scripts ${script.name}`;
      const check = await runCheck('npm', ['run', '--ignore-scripts', script.name], worktree, command);
      state.checks.push(check);
      options.onCheck?.({ command, status: check.status });
      await writeState(workflowRoot, state);
      if (check.status !== 'passed') throw new Error(`Required check failed: ${command}`);
    }
    const diffCheck = await runCheck('git', ['diff', '--check', `${repository.targetCommit}..${state.implementation_commit}`], worktree, 'git diff --check');
    state.checks.push(diffCheck);
    options.onCheck?.({ command: diffCheck.command, status: diffCheck.status });
    await writeState(workflowRoot, state);
    if (diffCheck.status !== 'passed') throw new Error('Required check failed: git diff --check');

    const checkedCommit = await gitOutput(worktree, ['rev-parse', 'HEAD']);
    const checkedDiff = await gitOutput(worktree, ['diff', '--binary', `${repository.targetCommit}..${checkedCommit}`]);
    if (checkedCommit !== state.implementation_commit || createHash('sha256').update(checkedDiff).digest('hex') !== state.diff_hash) {
      throw new Error('Implementation changed while checks were running');
    }

    state.phase = 'reviewing';
    await writeState(workflowRoot, state);
    const review = await runRoleWithRetries({
      role: 'reviewer', binding: roles.reviewer, cwd: worktree,
      prompt: JSON.stringify({
        role: 'reviewer', objective, plan, advice,
        implementation_commit: state.implementation_commit,
        diff_hash: state.diff_hash,
        diff: checkedDiff,
        checks: state.checks.map(({ command, status }) => ({ command, status })),
        task: 'Return JSON with decision "accept" or "reject" and a reason string. Do not modify files.',
      }),
      attempts: options.maxAttempts, state, workflowRoot,
    });
    if (review['decision'] !== 'accept') throw new Error(`Reviewer rejected the implementation: ${String(review['reason'] ?? 'no reason')}`);

    await assertMergeSafety(repository, state);
    await assertTargetUnchanged(repository);
    await mergeReviewedCommit(repository.root, state.implementation_commit);
    state.merge_commit = await gitOutput(repository.root, ['rev-parse', 'HEAD']);
    if (state.merge_commit === repository.targetCommit || !await gitSucceeds(repository.root, ['merge-base', '--is-ancestor', state.implementation_commit, state.merge_commit])) {
      throw new Error('Merge did not incorporate the reviewed implementation commit');
    }
    state.phase = 'merged';
    await writeState(workflowRoot, state);
    return state;
  } catch (error) {
    state.phase = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    await writeState(workflowRoot, state);
    throw Object.assign(new Error(state.error), { workflowState: state });
  } finally {
    if (worktreeCreated) {
      try {
        await git(repository.root, ['worktree', 'remove', '--force', worktree]);
        await git(repository.root, ['branch', state.phase === 'merged' ? '-d' : '-D', workflowBranch]);
      } catch (cleanupError) {
        const completedMerge = state.phase === 'merged';
        const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        state.error = state.error ? `${state.error}; cleanup failed: ${detail}` : `Workflow cleanup failed: ${detail}`;
        if (completedMerge) state.phase = 'failed';
        await writeState(workflowRoot, state);
        if (completedMerge) throw new Error(state.error);
      }
    }
  }
}

async function readObjective(options: NativeRoleWorkflowOptions): Promise<string> {
  if (Boolean(options.objective) === Boolean(options.objectiveFile)) {
    throw new Error('Provide the objective through stdin or --objective-file, but not both');
  }
  let value: string;
  if (options.objectiveFile) {
    const resolved = path.resolve(options.objectiveFile);
    const stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_OBJECTIVE_BYTES) {
      throw new Error('Objective file must be a regular non-symlink file within the size limit');
    }
    const handle = await fs.open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
        throw new Error('Objective file changed during validation');
      }
      value = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } else {
    value = options.objective ?? '';
  }
  if (Buffer.byteLength(value) > MAX_OBJECTIVE_BYTES) throw new Error('Workflow objective exceeds 128000 bytes');
  const objective = value.trim();
  if (!objective) throw new Error('Workflow objective must not be empty');
  return objective;
}

async function inspectRepository(cwd: string): Promise<RepositorySnapshot> {
  const root = await gitOutput(cwd, ['rev-parse', '--show-toplevel']);
  const targetBranch = await gitOutput(root, ['symbolic-ref', '--short', 'HEAD']);
  const targetCommit = await gitOutput(root, ['rev-parse', 'HEAD']);
  await assertClean(root, 'Target repository');
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { scripts?: Record<string, unknown> };
  const scripts = ['typecheck', 'test', 'lint'].flatMap((name) => {
    const value = manifest.scripts?.[name];
    return typeof value === 'string' && value.trim() ? [{ name, value }] : [];
  });
  if (!scripts.some((script) => script.name === 'typecheck') || !scripts.some((script) => script.name === 'test')) {
    throw new Error('Target repository must define meaningful typecheck and test package scripts');
  }
  const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json'];
  const present = (await Promise.all(lockfiles.map(async (name) => fs.access(path.join(root, name)).then(() => name, () => null)))).filter((name): name is string => Boolean(name));
  if (present.length !== 1) throw new Error('Target repository must contain exactly one npm lockfile');
  return { root, targetBranch, targetCommit, packageManager: 'npm', scripts, lockfile: present[0]! };
}

async function assertExecutables(roles: NativeRoleWorkflowState['roles']): Promise<void> {
  for (const cli of new Set(Object.values(roles).filter(Boolean).map((binding) => binding!.cli))) {
    const found = await findExecutable(cli);
    if (!found) throw new Error(`${cli} CLI is not available on PATH`);
  }
}

async function findExecutable(command: string): Promise<string | null> {
  for (const directory of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    if (await fs.access(candidate, fsConstants.X_OK).then(() => true, () => false)) return candidate;
  }
  return null;
}

async function runRoleWithRetries(input: {
  role: WorkflowRole;
  binding: WorkflowBinding;
  cwd: string;
  prompt: string;
  attempts: number;
  state: NativeRoleWorkflowState;
  workflowRoot: string;
}): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;
  for (let number = 1; number <= input.attempts; number++) {
    const attempt = {
      id: `${input.role}-${number}-${randomUUID().slice(0, 8)}`,
      role: input.role,
      cli: input.binding.cli,
      model: input.binding.model,
      status: 'started' as const,
      started_at: new Date().toISOString(),
    };
    input.state.attempts.push(attempt);
    await writeState(input.workflowRoot, input.state);
    try {
      const value = await spawnRole(input.role, input.binding, input.cwd, input.prompt);
      validateRoleResult(input.role, value);
      Object.assign(attempt, { status: 'succeeded', finished_at: new Date().toISOString() });
      await writeState(input.workflowRoot, input.state);
      return value;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      Object.assign(attempt, { status: 'failed', finished_at: new Date().toISOString(), error: lastError.message });
      await writeState(input.workflowRoot, input.state);
    }
  }
  throw lastError ?? new Error(`${input.role} failed`);
}

async function spawnRole(role: WorkflowRole, binding: WorkflowBinding, cwd: string, prompt: string): Promise<Record<string, unknown>> {
  const args = binding.cli === 'codex'
    ? ['exec', '--json', '--sandbox', 'read-only', '--model', binding.model, '-']
    : [
        '--print', '--output-format', 'stream-json', '--verbose', '--model', binding.model,
        ...(role === 'implementer' ? ['--dangerously-skip-permissions'] : []),
        ...(role === 'adviser'
          ? ['--max-turns', '1', '--bare', '--tools', '', '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence']
          : []),
      ];
  const env = childEnvironment(role, cwd);
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binding.cli, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2_000);
    }, 600_000);
    const append = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(-MAX_PROCESS_OUTPUT_BYTES);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) reject(new Error(`${role} timed out`));
      else if (code !== 0) reject(new Error(`${role} CLI exited with code ${code}`));
      else resolve(stdout);
    });
    child.stdin.end(prompt);
  });
  let resultText = '';
  const lines = output.trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const event = parsed as Record<string, unknown>;
      if (binding.cli === 'codex') {
        const item = event['item'];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const message = item as Record<string, unknown>;
          if (message['type'] === 'agent_message' && typeof message['text'] === 'string') resultText = message['text'];
        }
      } else if (event['type'] === 'result' && typeof event['result'] === 'string') {
        resultText = event['result'];
      } else if (!('type' in event)) {
        resultText = line;
      }
    } catch { /* Continue to the previous JSONL record. */ }
  }
  if (resultText) {
    try {
      const parsed: unknown = JSON.parse(resultText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* Report malformed structured output below. */ }
  }
  throw new Error(`${role} returned malformed JSON`);
}

function childEnvironment(role: WorkflowRole, cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    HOME: process.env['HOME'],
    TMPDIR: process.env['TMPDIR'],
    LANG: process.env['LANG'],
    HTTP_PROXY: process.env['HTTP_PROXY'],
    HTTPS_PROXY: process.env['HTTPS_PROXY'],
    NO_PROXY: process.env['NO_PROXY'],
    http_proxy: process.env['http_proxy'],
    https_proxy: process.env['https_proxy'],
    no_proxy: process.env['no_proxy'],
    ORCH_WORKFLOW_ROLE: role,
  };
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

async function runCheck(command: string, args: string[], cwd: string, display: string) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd, maxBuffer: MAX_PROCESS_OUTPUT_BYTES });
    void stdout;
    void stderr;
    return { command: display, status: 'passed' as const, output: 'Command completed successfully' };
  } catch {
    return { command: display, status: 'failed' as const, output: 'Command exited non-zero' };
  }
}

async function assertFrozenManifest(worktree: string, repository: RepositorySnapshot): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(path.join(worktree, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
  for (const script of repository.scripts) {
    if (manifest.scripts?.[script.name] !== script.value) throw new Error(`Implementer changed the ${script.name} check definition`);
  }
  await fs.access(path.join(worktree, repository.lockfile));
}

async function assertTargetUnchanged(repository: RepositorySnapshot): Promise<void> {
  const branch = await gitOutput(repository.root, ['symbolic-ref', '--short', 'HEAD']);
  const commit = await gitOutput(repository.root, ['rev-parse', 'HEAD']);
  if (branch !== repository.targetBranch || commit !== repository.targetCommit) throw new Error('Target branch changed before workflow execution');
  await assertClean(repository.root, 'Target repository');
}

async function assertMergeSafety(repository: RepositorySnapshot, state: NativeRoleWorkflowState): Promise<void> {
  if (!state.implementation_commit || !state.diff_hash) throw new Error('Reviewed implementation evidence is incomplete');
  await assertClean(state.worktree, 'Implementation worktree');
  const worktreeRoot = await gitOutput(state.worktree, ['rev-parse', '--show-toplevel']);
  const worktreeBranch = await gitOutput(state.worktree, ['symbolic-ref', '--short', 'HEAD']);
  if (path.resolve(worktreeRoot) !== path.resolve(state.worktree) || worktreeBranch !== state.workflow_branch) {
    throw new Error('Implementation worktree no longer matches the workflow job');
  }
  const branchCommit = await gitOutput(state.worktree, ['rev-parse', 'HEAD']);
  const diff = await gitOutput(state.worktree, ['diff', '--binary', `${repository.targetCommit}..${branchCommit}`]);
  const hash = createHash('sha256').update(diff).digest('hex');
  if (branchCommit !== state.implementation_commit || hash !== state.diff_hash) throw new Error('Reviewed implementation changed before merge');
}

async function mergeReviewedCommit(root: string, commit: string): Promise<void> {
  try {
    await git(root, ['merge', '--no-ff', '--no-edit', commit]);
  } catch (error) {
    const mergeHead = await gitOutput(root, ['rev-parse', '--git-path', 'MERGE_HEAD']);
    if (await fs.access(mergeHead).then(() => true, () => false)) {
      await git(root, ['merge', '--abort']);
    }
    await assertClean(root, 'Target repository after failed merge');
    throw error;
  }
}

async function assertClean(cwd: string, label: string): Promise<void> {
  const status = await gitOutput(cwd, ['status', '--porcelain']);
  if (status) throw new Error(`${label} must be clean`);
}

async function writeState(root: string, state: NativeRoleWorkflowState): Promise<void> {
  const target = path.join(root, 'state.json');
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, target);
}

function validateRoleResult(role: WorkflowRole, value: Record<string, unknown>): void {
  if (role === 'supervisor' && (typeof value['plan'] !== 'string' || !value['plan'].trim())) {
    throw new Error('Supervisor returned no plan');
  }
  if (role === 'adviser' && (typeof value['advice'] !== 'string' || !value['advice'].trim())) {
    throw new Error('Adviser returned no advice');
  }
  if (role === 'implementer' && value['status'] !== 'completed') {
    throw new Error('Implementer did not report completed status');
  }
  if (role === 'reviewer' && value['decision'] !== 'accept' && value['decision'] !== 'reject') {
    throw new Error('Reviewer returned no valid decision');
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, maxBuffer: MAX_PROCESS_OUTPUT_BYTES });
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  return execFileAsync('git', args, { cwd, maxBuffer: MAX_PROCESS_OUTPUT_BYTES }).then(() => true, () => false);
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: MAX_PROCESS_OUTPUT_BYTES });
  return stdout.trim();
}
