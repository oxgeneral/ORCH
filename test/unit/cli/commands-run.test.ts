import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerRunCommand } from '../../../src/cli/commands/run.js';
import { makeContainer } from './helpers.js';
import type { OrchestratorEvent } from '../../../src/domain/events.js';

describe('run command', () => {
  let program: Command;
  let container: Container;
  let emitRunEvent: ((event: OrchestratorEvent) => void) | undefined;

  beforeEach(() => {
    process.exitCode = undefined;
    program = new Command();
    program.exitOverride();
    container = makeContainer();
    (container.eventBus.onAny as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (event: OrchestratorEvent) => void) => {
        emitRunEvent = handler;
        return vi.fn();
      },
    );
    (container.orchestrator.runTask as ReturnType<typeof vi.fn>).mockImplementation(
      async (taskId: string) => {
        emitRunEvent?.({ type: 'agent:started', taskId, runId: 'run_1', agentId: 'agt_1' });
        emitRunEvent?.({ type: 'agent:completed', runId: 'run_1', agentId: 'agt_1', success: true });
      },
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerRunCommand(program, container);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  describe('run <task-id>', () => {
    it('calls orchestrator.runTask with task id', async () => {
      await program.parseAsync(['run', 'tsk_1'], { from: 'user' });

      expect(container.orchestrator.runTask).toHaveBeenCalledWith('tsk_1');
    });

    it('subscribes to eventBus for live output', async () => {
      await program.parseAsync(['run', 'tsk_1'], { from: 'user' });

      expect(container.eventBus.onAny).toHaveBeenCalled();
    });

    it('unsubscribes from eventBus after run completes', async () => {
      const unsub = vi.fn();
      (container.eventBus.onAny as ReturnType<typeof vi.fn>).mockReturnValue(unsub);

      await program.parseAsync(['run', 'tsk_1'], { from: 'user' });

      expect(unsub).toHaveBeenCalled();
    });

    it('unsubscribes even when orchestrator.runTask throws', async () => {
      const unsub = vi.fn();
      (container.eventBus.onAny as ReturnType<typeof vi.fn>).mockReturnValue(unsub);
      (container.orchestrator.runTask as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      await expect(
        program.parseAsync(['run', 'tsk_1'], { from: 'user' }),
      ).rejects.toThrow('fail');

      expect(unsub).toHaveBeenCalled();
    });

    it('sets exit code 1 when the requested run fails after dispatch returns', async () => {
      (container.orchestrator.runTask as ReturnType<typeof vi.fn>).mockImplementation(
        async (taskId: string) => {
          emitRunEvent?.({ type: 'agent:started', taskId, runId: 'run_failed', agentId: 'agt_1' });
        },
      );

      await program.parseAsync(['run', 'tsk_1'], { from: 'user' });
      expect(process.exitCode).toBeUndefined();

      emitRunEvent?.({ type: 'agent:completed', runId: 'run_failed', agentId: 'agt_1', success: false });

      expect(process.exitCode).toBe(1);
    });

    it('leaves the exit code unchanged when the requested run succeeds', async () => {
      await program.parseAsync(['run', 'tsk_1'], { from: 'user' });

      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('run --all', () => {
    it('calls orchestrator.runAll', async () => {
      await program.parseAsync(['run', '--all'], { from: 'user' });

      expect(container.orchestrator.runAll).toHaveBeenCalled();
    });
  });

  describe('no args', () => {
    it('prints error when no task-id or flags', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

      await expect(program.parseAsync(['run'], { from: 'user' })).rejects.toThrow();

      exitSpy.mockRestore();
    });
  });
});
