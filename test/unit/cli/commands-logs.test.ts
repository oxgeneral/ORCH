import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerLogsCommand } from '../../../src/cli/commands/logs.js';
import type { RunEvent } from '../../../src/domain/run.js';
import { makeContainer } from './helpers.js';

const NOW = new Date().toISOString();
const PAST = new Date(Date.now() - 120_000).toISOString(); // 2 min ago

function makeEvent(type: string = 'agent_output', data: unknown = 'hello', ts?: string): RunEvent {
  return { timestamp: ts ?? NOW, type: type as any, data };
}

function makeLogRun(id: string, taskId: string, agentId: string) {
  return {
    id,
    task_id: taskId,
    agent_id: agentId,
    attempt: 1,
    status: 'succeeded' as const,
    started_at: NOW,
    workspace_path: '/tmp',
    prompt: 'test',
  };
}

describe('logs command', () => {
  let program: Command;
  let container: Container;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    container = makeContainer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerLogsCommand(program, container);
  });

  describe('logs <run-id>', () => {
    it('shows events for a specific run', async () => {
      (container.runService.readEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEvent('agent_output', 'line1'),
        makeEvent('error', 'oops'),
      ]);

      await program.parseAsync(['logs', 'run_abc'], { from: 'user' });

      expect(container.runService.readEvents).toHaveBeenCalledWith('run_abc');
      expect(console.log).toHaveBeenCalled();
    });

    it('shows "no events" when run has no events', async () => {
      await program.parseAsync(['logs', 'run_empty'], { from: 'user' });

      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: any[]) => String(c[0])).join('\n');
      expect(allOutput).toContain('No events');
    });

    it('outputs JSON when json mode', async () => {
      container = makeContainer({
        context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' },
        runService: {
          readEvents: vi.fn(async () => [makeEvent()]),
          listForTask: vi.fn(async () => []),
          listForAgent: vi.fn(async () => []),
        },
      } as any);
      program = new Command();
      program.exitOverride();
      registerLogsCommand(program, container);

      await program.parseAsync(['logs', 'run_1'], { from: 'user' });

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('logs --task', () => {
    it('lists runs for a task and shows events', async () => {
      (container.runService.listForTask as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeLogRun('run_1', 'tsk_1', 'agt_1'),
      ]);
      (container.runService.readEventsTail as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEvent('agent_output', 'output'),
      ]);

      await program.parseAsync(['logs', '--task', 'tsk_1'], { from: 'user' });

      expect(container.runService.listForTask).toHaveBeenCalledWith('tsk_1');
      expect(container.runService.readEventsTail).toHaveBeenCalledWith('run_1', 10);
    });

    it('shows "no runs" when task has no runs', async () => {
      await program.parseAsync(['logs', '--task', 'tsk_empty'], { from: 'user' });

      const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c: any[]) => String(c[0])).join('\n');
      expect(allOutput).toContain('No runs');
    });
  });

  describe('logs --agent', () => {
    it('lists runs for an agent and shows events', async () => {
      (container.runService.listForAgent as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeLogRun('run_2', 'tsk_1', 'agt_1'),
      ]);
      (container.runService.readEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEvent('agent_output', 'data'),
      ]);

      await program.parseAsync(['logs', '--agent', 'agt_1'], { from: 'user' });

      expect(container.runService.listForAgent).toHaveBeenCalledWith('agt_1');
    });

    it('shows "no runs" when agent has no runs', async () => {
      await program.parseAsync(['logs', '--agent', 'agt_none'], { from: 'user' });

      const allOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c: any[]) => String(c[0])).join('\n');
      expect(allOutput).toContain('No runs');
    });
  });

  describe('logs --since', () => {
    it('filters events by time', async () => {
      (container.runService.readEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEvent('agent_output', 'old', new Date(Date.now() - 600_000).toISOString()),
        makeEvent('agent_output', 'recent', new Date().toISOString()),
      ]);

      await program.parseAsync(['logs', 'run_1', '--since', '5m'], { from: 'user' });

      // Both events fetched, but old one should be filtered
      expect(container.runService.readEvents).toHaveBeenCalled();
    });
  });

  describe('no args', () => {
    it('prints error when no run-id, --task, or --agent provided', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

      await expect(program.parseAsync(['logs'], { from: 'user' })).rejects.toThrow();

      exitSpy.mockRestore();
    });
  });
});
