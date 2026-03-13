/**
 * Tests for TIME column in `orch task list`.
 * Verifies commit 4d3447a: done tasks use updated_at, not created_at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommand } from '../../../src/cli/commands/task.js';
import { makeContainer } from './helpers.js';

vi.mock('../../../src/cli/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/cli/output.js')>();
  return {
    ...actual,
    formatDurationSince: vi.fn((iso: string) => `AGE(${iso})`),
    printTable: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    dim: vi.fn((s: string) => `DIM(${s})`),
  };
});

vi.mock('../../../src/cli/editor.js', () => ({
  openInEditor: vi.fn(async () => ''),
  toEditorContent: vi.fn(() => ''),
  fromEditorContent: vi.fn(() => ({})),
}));

describe('task list TIME column', () => {
  let program: Command;
  let container: ReturnType<typeof makeContainer>;
  let printTable: ReturnType<typeof vi.fn>;
  let formatDurationSince: ReturnType<typeof vi.fn>;
  let dim: ReturnType<typeof vi.fn>;

  const CREATED = '2026-03-13T10:00:00.000Z';
  const UPDATED = '2026-03-13T12:00:00.000Z';

  beforeEach(async () => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    container = makeContainer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    registerTaskCommand(program, container);

    const output = await import('../../../src/cli/output.js');
    printTable = output.printTable as ReturnType<typeof vi.fn>;
    formatDurationSince = output.formatDurationSince as ReturnType<typeof vi.fn>;
    dim = output.dim as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('done task TIME uses updated_at', async () => {
    (container.taskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'tsk_1',
        title: 'Done task',
        status: 'done',
        priority: 3,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    ]);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(formatDurationSince).toHaveBeenCalledWith(UPDATED);
    expect(formatDurationSince).not.toHaveBeenCalledWith(CREATED);
  });

  it('in_progress task TIME uses updated_at', async () => {
    (container.taskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'tsk_2',
        title: 'Running task',
        status: 'in_progress',
        priority: 2,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    ]);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(formatDurationSince).toHaveBeenCalledWith(UPDATED);
    expect(formatDurationSince).not.toHaveBeenCalledWith(CREATED);
  });

  it('todo task TIME shows dash', async () => {
    (container.taskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'tsk_3',
        title: 'Pending task',
        status: 'todo',
        priority: 3,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    ]);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(formatDurationSince).not.toHaveBeenCalled();
    expect(dim).toHaveBeenCalledWith('—');
  });

  it('review task TIME shows dash', async () => {
    (container.taskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'tsk_4',
        title: 'Review task',
        status: 'review',
        priority: 3,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    ]);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(formatDurationSince).not.toHaveBeenCalled();
    expect(dim).toHaveBeenCalledWith('—');
  });

  it('failed task TIME shows dash', async () => {
    (container.taskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'tsk_5',
        title: 'Failed task',
        status: 'failed',
        priority: 2,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    ]);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(formatDurationSince).not.toHaveBeenCalled();
    expect(dim).toHaveBeenCalledWith('—');
  });

  it('done task without updated_at shows dash', async () => {
    (container.taskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'tsk_6',
        title: 'Done no updated_at',
        status: 'done',
        priority: 3,
        created_at: CREATED,
        updated_at: undefined,
      },
    ]);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(formatDurationSince).not.toHaveBeenCalled();
    expect(dim).toHaveBeenCalledWith('—');
  });

  it('printTable receives correct TIME value for done task', async () => {
    (container.taskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'tsk_7',
        title: 'Done table test',
        status: 'done',
        priority: 3,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    ]);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(printTable).toHaveBeenCalled();
    const rows = printTable.mock.calls[0][1] as string[][];
    // TIME is the last column (index 4)
    expect(rows[0][4]).toBe(`AGE(${UPDATED})`);
  });
});
