/**
 * Real-PTY end-to-end test for Codex activity rendering.
 *
 * Unlike ink-testing-library tests, this launches the built CLI in a genuine
 * pseudo-terminal through `expect`, drives the same hotkeys a user presses,
 * and asserts visible terminal frames.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { DEFAULT_CONFIG } from '../../src/domain/config.js';
import { DEFAULT_GLOBAL_CONFIG } from '../../src/domain/global-config.js';
import { DEFAULT_STATE } from '../../src/domain/state.js';
import type { Agent } from '../../src/domain/agent.js';
import type { Run, RunEvent } from '../../src/domain/run.js';
import type { Task } from '../../src/domain/task.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../..');
const cliPath = path.join(repoRoot, 'dist/cli.js');
const expectScript = path.join(testDir, 'tui-codex-logs.exp');

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(events: RunEvent[]): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

async function createFixture(projectRoot: string, globalConfigPath: string): Promise<void> {
  const orchRoot = path.join(projectRoot, '.orchestry');
  const agentsDir = path.join(orchRoot, 'agents');
  const tasksDir = path.join(orchRoot, 'tasks');
  const runsDir = path.join(orchRoot, 'runs');
  await Promise.all([
    mkdir(agentsDir, { recursive: true }),
    mkdir(tasksDir, { recursive: true }),
    mkdir(runsDir, { recursive: true }),
    mkdir(path.dirname(globalConfigPath), { recursive: true }),
  ]);

  const now = new Date('2026-07-25T12:00:00.000Z');
  const agent: Agent = {
    id: 'agt_pty',
    name: 'PTY Codex',
    adapter: 'codex',
    config: { model: 'gpt-5' },
    status: 'idle',
    stats: {
      tasks_completed: 1,
      tasks_failed: 1,
      total_runs: 2,
      total_runtime_ms: 2_000,
    },
  };
  const task: Task = {
    id: 'tsk_pty',
    title: 'Render Codex logs in a real PTY',
    description: 'E2E fixture',
    status: 'done',
    priority: 2,
    assignee: agent.id,
    labels: [],
    depends_on: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    attempts: 1,
    max_attempts: 3,
    workspace_mode: 'shared',
  };
  const successfulRun: Run = {
    id: 'run_pty_text',
    task_id: task.id,
    agent_id: agent.id,
    attempt: 1,
    status: 'succeeded',
    started_at: new Date(now.getTime() + 2_000).toISOString(),
    finished_at: new Date(now.getTime() + 3_000).toISOString(),
    workspace_path: projectRoot,
    prompt: 'PTY fixture',
  };
  const failedRun: Run = {
    ...successfulRun,
    id: 'run_pty_error',
    status: 'failed',
    started_at: new Date(now.getTime() + 1_000).toISOString(),
    finished_at: new Date(now.getTime() + 1_500).toISOString(),
    error: 'PTY unsupported model',
  };
  const textEvents: RunEvent[] = [
    { timestamp: now.toISOString(), type: 'agent_output', data: { type: 'thread.started', thread_id: 'pty' } },
    { timestamp: now.toISOString(), type: 'agent_output', data: { type: 'turn.started' } },
    { timestamp: now.toISOString(), type: 'agent_output', data: { id: 'item_1', type: 'agent_message', text: 'PTY_VISIBLE_AGENT_TEXT' } },
    { timestamp: now.toISOString(), type: 'command_run', data: { id: 'item_2', type: 'command_execution', command: 'printf PTY_VISIBLE_TOOL', status: 'completed', exit_code: 0 } },
    { timestamp: now.toISOString(), type: 'done', data: { type: 'turn.completed' } },
  ];
  const providerError = JSON.stringify({
    type: 'error',
    status: 400,
    error: { type: 'invalid_request_error', message: 'PTY unsupported model' },
  });
  const errorEvents: RunEvent[] = [
    { timestamp: now.toISOString(), type: 'error', data: { id: 'item_0', type: 'error', message: 'Model metadata for `gpt-5.6` not found. Defaulting to fallback metadata.' } },
    { timestamp: now.toISOString(), type: 'error', data: { type: 'error', message: providerError } },
    { timestamp: now.toISOString(), type: 'error', data: { type: 'turn.failed', error: { message: providerError } } },
  ];

  const config = structuredClone(DEFAULT_CONFIG);
  config.project.name = 'PTY Codex E2E';
  config.defaults.agent.adapter = 'codex';
  config.defaults.agent.workspace_mode = 'shared';
  const state = structuredClone(DEFAULT_STATE);
  state.onboardingCompleted = true;
  state.stats.total_runs = 2;
  state.stats.total_tasks_completed = 1;
  state.stats.total_tasks_failed = 1;

  await Promise.all([
    writeFile(path.join(orchRoot, 'config.yml'), yaml.dump(config)),
    writeFile(path.join(orchRoot, 'state.json'), json({ ...state, claimed: [] })),
    writeFile(path.join(agentsDir, '_index.json'), json([agent])),
    writeFile(path.join(tasksDir, '_index.json'), json([task])),
    writeFile(path.join(runsDir, `${successfulRun.id}.json`), json(successfulRun)),
    writeFile(path.join(runsDir, `${successfulRun.id}.jsonl`), jsonl(textEvents)),
    writeFile(path.join(runsDir, `${failedRun.id}.json`), json(failedRun)),
    writeFile(path.join(runsDir, `${failedRun.id}.jsonl`), jsonl(errorEvents)),
    writeFile(globalConfigPath, yaml.dump({
      ...DEFAULT_GLOBAL_CONFIG,
      tui: { ...DEFAULT_GLOBAL_CONFIG.tui, activity_filter: 'all' },
    })),
  ]);
}

async function main(): Promise<void> {
  try {
    execFileSync('expect', ['-v'], { stdio: 'ignore' });
  } catch {
    throw new Error('The real-PTY TUI test requires the `expect` executable.');
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'orch-tui-pty-'));
  const projectRoot = path.join(tempRoot, 'project');
  const globalConfigPath = path.join(tempRoot, 'home', 'global.yml');

  try {
    await createFixture(projectRoot, globalConfigPath);
    const result = spawnSync(
      'expect',
      [expectScript, cliPath, projectRoot, globalConfigPath],
      { cwd: projectRoot, encoding: 'utf8', timeout: 45_000 },
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Real-PTY TUI test exited with status ${result.status ?? 'unknown'}`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
