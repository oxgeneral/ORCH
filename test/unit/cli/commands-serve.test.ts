import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerServeCommand } from '../../../src/cli/commands/serve.js';
import { makeContainer } from './helpers.js';

describe('serve command', () => {
  let program: Command;
  let container: ReturnType<typeof makeContainer>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    container = makeContainer({
      taskStore: {
        list: vi.fn(async () => []),
      } as any,
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerServeCommand(program, container);
  });

  describe('watch mode (default)', () => {
    it('calls orchestrator.startWatch', async () => {
      await program.parseAsync(['serve'], { from: 'user' });

      expect(container.orchestrator.startWatch).toHaveBeenCalled();
    });

    it('subscribes to eventBus before startWatch', async () => {
      const callOrder: string[] = [];
      (container.eventBus.onAny as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('subscribe');
        return vi.fn();
      });
      (container.orchestrator.startWatch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('startWatch');
      });

      await program.parseAsync(['serve'], { from: 'user' });

      expect(callOrder).toEqual(['subscribe', 'startWatch']);
    });
  });

  describe('--tick-interval', () => {
    it('overrides config poll_interval_ms', async () => {
      await program.parseAsync(['serve', '--tick-interval', '3000'], { from: 'user' });

      expect(container.config.scheduling.poll_interval_ms).toBe(3000);
    });

    it('ignores invalid tick interval', async () => {
      await program.parseAsync(['serve', '--tick-interval', 'abc'], { from: 'user' });

      expect(container.config.scheduling.poll_interval_ms).toBe(5000); // original from makeContainer
    });
  });

  describe('--once mode', () => {
    it('calls orchestrator.startWatch and stop via once runner', async () => {
      (container.taskStore as any).list = vi.fn(async () => [
        { id: 'tsk_1', status: 'done' },
      ]);

      await program.parseAsync(['serve', '--once'], { from: 'user' });

      expect(container.orchestrator.startWatch).toHaveBeenCalled();
      expect(container.orchestrator.stop).toHaveBeenCalled();
    });

    it('sets exitCode=0 when all tasks done', async () => {
      (container.taskStore as any).list = vi.fn(async () => [
        { id: 'tsk_1', status: 'done' },
      ]);

      await program.parseAsync(['serve', '--once'], { from: 'user' });

      expect(process.exitCode).toBe(0);
    });

    it('sets exitCode=1 when any task failed', async () => {
      (container.taskStore as any).list = vi.fn(async () => [
        { id: 'tsk_1', status: 'done' },
        { id: 'tsk_2', status: 'failed' },
      ]);

      await program.parseAsync(['serve', '--once'], { from: 'user' });

      expect(process.exitCode).toBe(1);
    });
  });
});
