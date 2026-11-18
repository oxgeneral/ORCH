import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildFullContainer, buildLightContainer, type Container } from '../../src/container.js';
import type { CreateAgentInput } from '../../src/domain/agent.js';
import type { CreateTaskInput } from '../../src/domain/task.js';

describe('task lifecycle with file stores and real processes', () => {
  let root: string;
  let c: Container;
  function git(...args: string[]) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-lifecycle-'));
    await fs.mkdir(path.join(root, '.orchestry'));
    git('init', '-q');
    git('config', 'user.name', 'Lifecycle test');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    await fs.writeFile(path.join(root, '.gitignore'), '.orchestry/\n');
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "require(\'fs\').accessSync(\'result.txt\')"' } }));
    git('add', '.gitignore', 'package.json');
    git('commit', '-qm', 'fixture');
    c = await buildFullContainer({ projectRoot: root, ascii: true, noColor: true, quiet: true, json: false });
  });
  afterEach(async () => {
    if (c.orchestrator.isOwner) await c.orchestrator.stop();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function job(command: string, agent: Partial<CreateAgentInput> = {}, task: Partial<CreateTaskInput> = {}) {
    const worker = await c.agentService.create({ name: task.title ?? 'worker', adapter: 'shell', workspace_mode: 'shared', command, ...agent });
    return c.taskService.create({ title: 'job', assignee: worker.id, max_attempts: 1, ...task });
  }

  const idle = () => vi.waitFor(() => expect(c.orchestrator.isOwner).toBe(false), { timeout: 5000 });

  it('keeps dirty work and lets the operator commit and approve it later', async () => {
    const task = await job('echo draft > result.txt', { workspace_mode: 'worktree' });
    await c.orchestrator.runTask(task.id);
    await idle();
    const review = await c.taskService.get(task.id);
    expect(review.status).toBe('review');
    expect(await fs.readFile(path.join(review.workspace!, 'result.txt'), 'utf8')).toBe('draft\n');
    const client = await buildLightContainer(c.context);
    await expect(client.taskService.updateStatus(task.id, 'done')).rejects.toThrow('Commit outstanding changes');
    git('-C', review.workspace!, 'add', 'result.txt');
    git('-C', review.workspace!, 'commit', '-qm', 'draft');
    await client.taskService.updateStatus(task.id, 'done');
    expect(await fs.readFile(path.join(root, 'result.txt'), 'utf8')).toBe('draft\n');
    await expect(fs.access(review.workspace!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks the worktree before manual approval and preserves it on rejection', async () => {
    const base = git('rev-parse', 'HEAD');
    const task = await job('echo draft >> result.txt && git add result.txt && git commit -qm draft',
      { approval_policy: 'manual', workspace_mode: 'worktree' }, { review_criteria: ['test_pass'] });
    await c.orchestrator.runTask(task.id);
    await idle();
    const review = await c.taskService.get(task.id);
    expect(review.status).toBe('review');
    expect(review.review_results?.[0]?.passed).toBe(true);
    expect(git('rev-parse', 'HEAD')).toBe(base);
    const cli = await buildLightContainer(c.context);
    await cli.taskService.reject(task.id, 'Add another line');
    await c.orchestrator.runTask(task.id);
    await idle();
    expect(git('rev-parse', 'HEAD')).toBe(base);
    await cli.taskService.updateStatus(task.id, 'done');
    expect(await fs.readFile(path.join(root, 'result.txt'), 'utf8')).toBe('draft\ndraft\n');
  });

  it('approves a legacy review whose merged branch was already removed, but protects new missing work', async () => {
    const task = await job('true');
    const proof = { branch: 'orchestry/old-branch', files_changed: [] };
    await c.taskStore.save({ ...task, status: 'review', proof });
    expect((await c.taskService.updateStatus(task.id, 'done')).status).toBe('done');
    await c.taskStore.save({ ...task, status: 'review', proof: { ...proof, pending_merge: true } });
    await expect(c.taskService.updateStatus(task.id, 'done')).rejects.toThrow('Missing worktree');
    expect((await c.taskService.get(task.id)).status).toBe('review');
  });

  it('keeps the writer lock until completion and lets a second client run afterwards', async () => {
    const other = await buildFullContainer(c.context);
    const a = await job('sleep 0.3', {}, { title: 'first' });
    const b = await job('echo done', {}, { title: 'second' });
    await c.orchestrator.runTask(a.id);
    await expect(other.orchestrator.runTask(b.id)).rejects.toMatchObject({ exitCode: 4 });
    await idle();
    await other.orchestrator.runTask(b.id);
    await vi.waitFor(() => expect(other.orchestrator.isOwner).toBe(false));
    expect((await c.stateStore.read()).running).toEqual({});
    expect((await c.taskService.list()).map((t) => t.status)).toEqual(['done', 'done']);
  });

  it('accepts cancellation from a second client while the run owns the lock', async () => {
    const task = await job('sleep 20');
    await c.orchestrator.runTask(task.id);
    const other = await buildFullContainer(c.context);
    await other.orchestrator.cancelTask(task.id);
    await idle();
    expect((await c.taskService.get(task.id)).status).toBe('cancelled');
    expect((await c.runService.listAll())[0]?.status).toBe('cancelled');
    expect((await c.stateStore.read()).running).toEqual({});
  });

  it('blocks a direct run until its dependency completes', async () => {
    const parent = await job('echo parent', {}, { title: 'parent' });
    const child = await job('echo child', {}, { title: 'child', depends_on: [parent.id] });
    await expect(c.orchestrator.runTask(child.id)).rejects.toThrow('unfinished dependencies');
    expect((await c.taskService.get(child.id)).attempts).toBe(0);
    await c.orchestrator.runTask(parent.id);
    await idle();
    await c.orchestrator.runTask(child.id);
    await idle();
    expect((await c.taskService.get(child.id)).status).toBe('done');
  });

  it.each(['watch', 'runAll'])('respects retry backoff in %s mode', async (mode) => {
    c.config.scheduling.poll_interval_ms = 50;
    c.config.scheduling.retry_base_delay_ms = 800;
    const task = await job('exit 1', {}, { max_attempts: 2 });
    const starts: number[] = [];
    c.eventBus.on('agent:started', () => starts.push(Date.now()));
    if (mode === 'watch') await c.orchestrator.startWatch({ skipAutonomousSeeding: true });
    else await c.orchestrator.runAll();
    await vi.waitFor(async () => expect((await c.taskService.get(task.id)).status).toBe('failed'), { timeout: 5000 });
    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(800);
  });

  it('releases the slot when an adapter never finishes its event stream', async () => {
    c.adapterRegistry.register({
      kind: 'shell',
      test: async () => ({ ok: true }),
      stop: async () => {},
      execute: () => ({
        pid: 0,
        events: (async function* () { await new Promise<void>(() => {}); })(),
      }),
    });
    const task = await job('true', { stall_timeout_ms: 80 });
    await c.orchestrator.runTask(task.id);
    await idle();
    expect((await c.taskService.get(task.id)).status).toBe('failed');
    expect((await c.stateStore.read()).running).toEqual({});
  });

  it.each([
    ['sleep 5', 150, 4000, 'stalled'],
    ['while true; do echo active; sleep 0.05; done', 2000, 350, 'timed out'],
  ] as const)('enforces deadlines while collecting %s', async (command, stall, total, message) => {
    const task = await job(command, { stall_timeout_ms: stall, timeout_ms: total });
    await c.orchestrator.runTask(task.id);
    await idle();
    expect((await c.taskService.get(task.id)).status).toBe('failed');
    expect((await c.runService.listAll())[0]?.error).toContain(message);
  });
});
