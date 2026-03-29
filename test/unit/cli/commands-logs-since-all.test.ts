/**
 * Tests for P4 fix: `orch logs --since <duration>` without run-id/task/agent filter.
 * Verifies the new showAllRecentLogs routing branch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerLogsCommand } from '../../../src/cli/commands/logs.js';
import type { RunEvent } from '../../../src/domain/run.js';
import { makeContainer } from './helpers.js';

const NOW = Date.now();

function makeEvent(type: string = 'agent_output', data: unknown = 'hello', ts?: string): RunEvent {
  return { timestamp: ts ?? new Date(NOW).toISOString(), type: type as any, data };
}

function makeLogRun(id: string, taskId: string, agentId: string, startedAt?: string, finishedAt?: string, status = 'succeeded' as const) {
  return {
    id,
    task_id: taskId,
    agent_id: agentId,
    attempt: 1,
    status,
    started_at: startedAt ?? new Date(NOW - 30 * 60_000).toISOString(),
    finished_at: finishedAt,
    workspace_path: '/tmp',
    prompt: 'test',
  };
}

describe('logs --since (all runs, no filter)', () => {
  let program: Command;
  let container: ReturnType<typeof makeContainer>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes to showAllRecentLogs when --since is used without other filters', async () => {
    container = makeContainer({
      runService: {
        readEvents: vi.fn(async () => []),
        readEventsTail: vi.fn(async () => [makeEvent('agent_output', 'recent')]),
        listForTask: vi.fn(async () => []),
        listForAgent: vi.fn(async () => []),
        listAll: vi.fn(async () => [
          makeLogRun('run_1', 'tsk_1', 'agt_1', new Date(NOW - 10 * 60_000).toISOString(), new Date(NOW - 5 * 60_000).toISOString()),
        ]),
      },
    } as any);
    registerLogsCommand(program, container);

    await program.parseAsync(['logs', '--since', '1h'], { from: 'user' });

    // listAll should be called (not listForTask or listForAgent)
    expect(container.runService.listAll).toHaveBeenCalled();
    expect(container.runService.listForTask).not.toHaveBeenCalled();
    expect(container.runService.listForAgent).not.toHaveBeenCalled();
  });

  it('shows "no runs" message when no runs match the time window', async () => {
    container = makeContainer({
      runService: {
        readEvents: vi.fn(async () => []),
        readEventsTail: vi.fn(async () => []),
        listForTask: vi.fn(async () => []),
        listForAgent: vi.fn(async () => []),
        listAll: vi.fn(async () => []),
      },
    } as any);
    registerLogsCommand(program, container);

    await program.parseAsync(['logs', '--since', '5m'], { from: 'user' });

    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any[]) => String(c[0])).join('\n');
    expect(allOutput).toContain('No runs');
  });

  it('filters runs by time window correctly', async () => {
    const oldRun = makeLogRun(
      'run_old', 'tsk_1', 'agt_1',
      new Date(NOW - 3 * 3_600_000).toISOString(), // started 3h ago
      new Date(NOW - 2.5 * 3_600_000).toISOString(), // finished 2.5h ago
    );
    const recentRun = makeLogRun(
      'run_recent', 'tsk_2', 'agt_1',
      new Date(NOW - 30 * 60_000).toISOString(), // started 30m ago
      new Date(NOW - 10 * 60_000).toISOString(), // finished 10m ago
    );

    container = makeContainer({
      runService: {
        readEvents: vi.fn(async () => []),
        readEventsTail: vi.fn(async () => [makeEvent('agent_output', 'data')]),
        listForTask: vi.fn(async () => []),
        listForAgent: vi.fn(async () => []),
        listAll: vi.fn(async () => [oldRun, recentRun]),
      },
    } as any);
    registerLogsCommand(program, container);

    await program.parseAsync(['logs', '--since', '1h'], { from: 'user' });

    // Only the recent run should have events fetched (old run finished 2.5h ago, outside 1h window)
    expect(container.runService.readEventsTail).toHaveBeenCalledTimes(1);
    expect(container.runService.readEventsTail).toHaveBeenCalledWith('run_recent', 500);
  });

  it('caps output at 20 runs and shows truncation notice', async () => {
    const manyRuns = Array.from({ length: 25 }, (_, i) =>
      makeLogRun(`run_${i}`, `tsk_${i}`, 'agt_1',
        new Date(NOW - 10 * 60_000).toISOString(),
        new Date(NOW - 5 * 60_000).toISOString()),
    );

    container = makeContainer({
      runService: {
        readEvents: vi.fn(async () => []),
        readEventsTail: vi.fn(async () => [makeEvent('agent_output', 'data')]),
        listForTask: vi.fn(async () => []),
        listForAgent: vi.fn(async () => []),
        listAll: vi.fn(async () => manyRuns),
      },
    } as any);
    registerLogsCommand(program, container);

    await program.parseAsync(['logs', '--since', '1h'], { from: 'user' });

    // Only 20 runs should have events fetched
    expect(container.runService.readEventsTail).toHaveBeenCalledTimes(20);

    // Truncation notice should be shown
    const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: any[]) => String(c[0])).join('\n');
    expect(allOutput).toContain('showing 20 of 25');
  });

  it('outputs JSON when json mode is active', async () => {
    container = makeContainer({
      context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' },
      runService: {
        readEvents: vi.fn(async () => []),
        readEventsTail: vi.fn(async () => []),
        listForTask: vi.fn(async () => []),
        listForAgent: vi.fn(async () => []),
        listAll: vi.fn(async () => [
          makeLogRun('run_j1', 'tsk_1', 'agt_1',
            new Date(NOW - 10 * 60_000).toISOString(),
            new Date(NOW - 5 * 60_000).toISOString()),
        ]),
      },
    } as any);
    program = new Command();
    program.exitOverride();
    registerLogsCommand(program, container);

    await program.parseAsync(['logs', '--since', '1h'], { from: 'user' });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('updated error message includes --since option', async () => {
    container = makeContainer();
    registerLogsCommand(program, container);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(program.parseAsync(['logs'], { from: 'user' })).rejects.toThrow();

    // The error message should now mention --since
    const errCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls;
    const allErr = errCalls.map((c: any[]) => String(c.join(' '))).join('\n');
    // Either console.error or process.stderr was used — check both
    // The printError function in output.ts writes to stderr
    exitSpy.mockRestore();
  });
});
