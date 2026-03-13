import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeContainer } from './helpers.js';

// Mock the container module so dynamic import returns a controlled full container
const mockCancelTask = vi.fn(async () => {});
const mockBuildFullContainer = vi.fn(async () => ({
  orchestrator: { cancelTask: mockCancelTask },
}));

vi.mock('../../../src/container.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/container.js')>();
  return { ...orig, buildFullContainer: mockBuildFullContainer };
});

describe('task cancel', () => {
  let registerTaskCommand: typeof import('../../../src/cli/commands/task.js').registerTaskCommand;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/cli/commands/task.js');
    registerTaskCommand = mod.registerTaskCommand;
  });

  it('uses orchestrator.cancelTask for in_progress tasks', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    const cancelMock = vi.fn(async () => ({ id: 'tsk_1', status: 'cancelled' }));
    const container = makeContainer({
      taskService: {
        get: vi.fn(async () => ({ id: 'tsk_1', title: 'Running', status: 'in_progress' })),
        cancel: cancelMock,
        list: vi.fn(async () => []),
      } as any,
    });

    registerTaskCommand(program, container);
    await program.parseAsync(['node', 'orch', 'task', 'cancel', 'tsk_1']);

    // Should NOT use taskService.cancel for in_progress
    expect(cancelMock).not.toHaveBeenCalled();
    // Should use orchestrator.cancelTask via full container
    expect(mockBuildFullContainer).toHaveBeenCalledWith(container.context);
    expect(mockCancelTask).toHaveBeenCalledWith('tsk_1');
  });

  it('uses taskService.cancel for non-running tasks', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    const cancelMock = vi.fn(async () => ({ id: 'tsk_1', status: 'cancelled' }));
    const container = makeContainer({
      taskService: {
        get: vi.fn(async () => ({ id: 'tsk_1', title: 'Queued', status: 'todo' })),
        cancel: cancelMock,
        list: vi.fn(async () => []),
      } as any,
    });

    registerTaskCommand(program, container);
    await program.parseAsync(['node', 'orch', 'task', 'cancel', 'tsk_1']);

    // Should use taskService.cancel for non-running tasks
    expect(cancelMock).toHaveBeenCalledWith('tsk_1');
    // Should NOT build full container
    expect(mockBuildFullContainer).not.toHaveBeenCalled();
  });

  it('uses taskService.cancel for review tasks', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    const cancelMock = vi.fn(async () => ({ id: 'tsk_2', status: 'cancelled' }));
    const container = makeContainer({
      taskService: {
        get: vi.fn(async () => ({ id: 'tsk_2', title: 'In Review', status: 'review' })),
        cancel: cancelMock,
        list: vi.fn(async () => []),
      } as any,
    });

    registerTaskCommand(program, container);
    await program.parseAsync(['node', 'orch', 'task', 'cancel', 'tsk_2']);

    expect(cancelMock).toHaveBeenCalledWith('tsk_2');
    expect(mockBuildFullContainer).not.toHaveBeenCalled();
  });
});
