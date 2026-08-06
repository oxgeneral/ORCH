import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const projectRoot = path.resolve('.');
const tsx = path.join(projectRoot, 'node_modules', '.bin', 'tsx');
const cli = path.join(projectRoot, 'src', 'bin', 'cli.ts');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('native role workflow CLI', () => {
  it('runs the direct path with real subprocesses, commits, checks, merge, and worktree cleanup', async () => {
    const fixture = await createFixture();
    const result = await runWorkflow(fixture, 'SUCCESS_OBJECTIVE');

    expect(result.code).toBe(0);
    const state = await latestState(fixture.repo);
    expect(state.phase).toBe('merged');
    expect(state.attempts.map((attempt) => `${attempt.role}:${attempt.status}`)).toEqual([
      'supervisor:succeeded',
      'implementer:succeeded',
      'reviewer:succeeded',
    ]);
    expect(state.checks.map((check) => `${check.command}:${check.status}`)).toEqual([
      'npm ci --ignore-scripts --no-audit --no-fund:passed',
      'npm run --ignore-scripts typecheck:passed',
      'npm run --ignore-scripts test:passed',
      'git diff --check:passed',
    ]);
    expect(await fs.readFile(path.join(fixture.repo, 'result.txt'), 'utf8')).toBe('SUCCESS_OBJECTIVE\n');
    expect(await exists(state.worktree)).toBe(false);
    expect(await git(fixture.repo, ['branch', '--list', state.workflow_branch])).toBe('');
  });

  it('bounds an enabled Adviser to one successful subprocess', async () => {
    const fixture = await createFixture();
    const result = await runWorkflow(fixture, 'ADVISER_OBJECTIVE', ['--adviser', 'claude', '--adviser-model', 'adviser-model']);

    expect(result.code).toBe(0);
    const state = await latestState(fixture.repo);
    expect(state.attempts.filter((attempt) => attempt.role === 'adviser').map((attempt) => attempt.status)).toEqual(['succeeded']);
    const adviserCalls = (await calls(fixture.home)).filter((call) => call.role === 'adviser');
    expect(adviserCalls).toHaveLength(1);
    expect(adviserCalls[0]?.argv).toContain('--no-session-persistence');
  });

  it('blocks merge when a required repository check fails', async () => {
    const fixture = await createFixture();
    const before = await git(fixture.repo, ['rev-parse', 'HEAD']);
    const result = await runWorkflow(fixture, 'FAIL_CHECK');

    expect(result.code).toBe(1);
    const state = await latestState(fixture.repo);
    expect(state.phase).toBe('failed');
    expect(state.error).toContain('Required check failed: npm run --ignore-scripts test');
    expect(await git(fixture.repo, ['rev-parse', 'HEAD'])).toBe(before);
    expect(await exists(path.join(fixture.repo, 'result.txt'))).toBe(false);
  });

  it('rejects an implementation commit outside the recorded target history', async () => {
    const fixture = await createFixture();
    const before = await git(fixture.repo, ['rev-parse', 'HEAD']);
    const result = await runWorkflow(fixture, 'NON_DESCENDANT');

    expect(result.code).toBe(1);
    const state = await latestState(fixture.repo);
    expect(state.error).toContain('does not descend from the recorded target');
    expect(await git(fixture.repo, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('refuses merge when the recorded target branch advances', async () => {
    const fixture = await createFixture();
    const before = await git(fixture.repo, ['rev-parse', 'HEAD']);
    const result = await runWorkflow(fixture, 'TARGET_ADVANCE');

    expect(result.code).toBe(1);
    const state = await latestState(fixture.repo);
    expect(state.phase).toBe('failed');
    expect(state.error).toContain('Target branch changed');
    expect(await git(fixture.repo, ['rev-parse', 'HEAD'])).not.toBe(before);
    expect(await exists(path.join(fixture.repo, 'result.txt'))).toBe(false);
  });

  it('accounts for reviewer failures exactly without retrying past the bound', async () => {
    const fixture = await createFixture();
    const result = await runWorkflow(fixture, 'REVIEW_FAIL');

    expect(result.code).toBe(1);
    const state = await latestState(fixture.repo);
    expect(state.attempts.map((attempt) => `${attempt.role}:${attempt.status}`)).toEqual([
      'supervisor:succeeded',
      'implementer:succeeded',
      'reviewer:failed',
    ]);
    expect((await calls(fixture.home)).filter((call) => call.role === 'reviewer')).toHaveLength(1);
  });

  it('counts invalid structured output as failed before a bounded retry', async () => {
    const fixture = await createFixture();
    const result = await runWorkflow(fixture, 'SUPERVISOR_RETRY', ['--max-attempts', '2']);

    expect(result.code).toBe(0);
    const state = await latestState(fixture.repo);
    expect(state.attempts.filter((attempt) => attempt.role === 'supervisor').map((attempt) => attempt.status)).toEqual(['failed', 'succeeded']);
  });

  it('does not merge a Reviewer rejection', async () => {
    const fixture = await createFixture();
    const before = await git(fixture.repo, ['rev-parse', 'HEAD']);
    const result = await runWorkflow(fixture, 'REVIEW_REJECT');

    expect(result.code).toBe(1);
    const state = await latestState(fixture.repo);
    expect(state.error).toContain('Reviewer rejected the implementation');
    expect(await git(fixture.repo, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('stops before any role subprocess when confirmation is refused', async () => {
    const fixture = await createFixture();
    const objectiveFile = path.join(fixture.root, 'objective.txt');
    await fs.writeFile(objectiveFile, 'REFUSED_OBJECTIVE\n', { mode: 0o600 });
    const result = await runWorkflow(fixture, 'n\n', ['--objective-file', objectiveFile], false);

    expect(result.code).toBe(0);
    expect((await latestState(fixture.repo)).phase).toBe('cancelled');
    expect(await calls(fixture.home)).toEqual([]);
  });

  it('keeps objectives and role prompts out of every subprocess argv', async () => {
    const fixture = await createFixture();
    const objective = 'ARGV_SECRET_SENTINEL';
    const result = await runWorkflow(fixture, objective);

    expect(result.code).toBe(0);
    const observed = await calls(fixture.home);
    expect(observed).toHaveLength(3);
    expect(observed.every((call) => !call.argv.join(' ').includes(objective))).toBe(true);
    expect(observed.every((call) => call.stdin.includes(objective))).toBe(true);
    expect(observed.every((call) => call.proxy === 'http://127.0.0.1:9')).toBe(true);
    const implementer = observed.find((call) => call.role === 'implementer');
    expect(implementer?.argv).toContain('--dangerously-skip-permissions');
    const adviser = observed.find((call) => call.role === 'adviser');
    expect(adviser).toBeUndefined();
  });
});

interface Fixture {
  root: string;
  repo: string;
  home: string;
  bin: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-native-role-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  await Promise.all([fs.mkdir(repo), fs.mkdir(home), fs.mkdir(bin)]);
  for (const command of ['codex', 'claude']) {
    const target = path.join(bin, command);
    await fs.copyFile(path.join(projectRoot, 'test', 'fixtures', 'fake-native-role-cli.mjs'), target);
    await fs.chmod(target, 0o755);
  }
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'workflow-fixture',
    version: '1.0.0',
    scripts: {
      typecheck: 'node check.mjs typecheck',
      test: 'node check.mjs test',
    },
  }, null, 2));
  await fs.writeFile(path.join(repo, 'package-lock.json'), JSON.stringify({
    name: 'workflow-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'workflow-fixture', version: '1.0.0' } },
  }, null, 2));
  await fs.writeFile(path.join(repo, 'check.mjs'), "import fs from 'node:fs'; if (process.argv[2] === 'test' && fs.existsSync('fail-check')) process.exit(1);\n");
  await fs.writeFile(path.join(repo, '.gitignore'), '.orchestry/\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'ORCH Test']);
  await git(repo, ['config', 'user.email', 'orch-test@example.invalid']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'fixture baseline']);
  return { root, repo, home, bin };
}

async function runWorkflow(fixture: Fixture, input: string, extra: string[] = [], yes = true) {
  const args = [cli, 'workflow',
    '--supervisor', 'codex', '--supervisor-model', 'supervisor-model',
    '--implementer', 'claude', '--implementer-model', 'implementer-model',
    '--reviewer', 'codex', '--reviewer-model', 'reviewer-model',
    '--max-attempts', '1',
    ...(yes ? ['--yes'] : []),
    ...extra,
  ];
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(tsx, args, {
      cwd: fixture.repo,
      env: {
        PATH: `${fixture.bin}${path.delimiter}${process.env.PATH ?? ''}`,
        HOME: fixture.home,
        TMPDIR: fixture.root,
        HTTP_PROXY: 'http://127.0.0.1:9',
        HTTPS_PROXY: 'http://127.0.0.1:9',
        NO_PROXY: '',
        no_proxy: '',
        NO_UPDATE_NOTIFIER: '1',
      },
      maxBuffer: 2_000_000,
    }, (error, stdout, stderr) => resolve({
      code: error && 'code' in error && typeof error.code === 'number' ? error.code : 0,
      stdout,
      stderr,
    }));
    child.stdin?.end(input);
  });
}

async function latestState(repo: string): Promise<any> {
  const root = path.join(repo, '.orchestry', 'workflows');
  const ids = await fs.readdir(root);
  expect(ids).toHaveLength(1);
  return JSON.parse(await fs.readFile(path.join(root, ids[0]!, 'state.json'), 'utf8'));
}

async function calls(home: string): Promise<Array<{ command: string; argv: string[]; stdin: string; role: string; proxy: string }>> {
  try {
    const content = await fs.readFile(path.join(home, 'native-role-calls.jsonl'), 'utf8');
    return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}
