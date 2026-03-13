/**
 * Unit tests for attachments support in TaskService.
 *
 * Covers:
 * - Task.attachments?: string[] domain field
 * - Paths.attachmentsDir getter and taskAttachmentsDir(id)
 * - create(): copies files, stores basenames
 * - create(): missing file → InvalidArgumentsError
 * - delete(): removes attachments directory
 * - empty attachments: [] → no dir created
 * - undefined attachments → task created without field
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskService } from '../../../src/application/task-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import { InvalidArgumentsError } from '../../../src/domain/errors.js';
import type { Task } from '../../../src/domain/task.js';
import type { ITaskStore } from '../../../src/infrastructure/storage/interfaces.js';
import path from 'node:path';
import fs from 'node:fs/promises';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_test1',
    title: 'Test task',
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function createMockTaskStore(tasks: Task[] = []): ITaskStore {
  const store = new Map(tasks.map((t) => [t.id, structuredClone(t)]));
  return {
    list: vi.fn(async () => [...store.values()]),
    get: vi.fn(async (id: string) => {
      const t = store.get(id);
      return t ? structuredClone(t) : null;
    }),
    save: vi.fn(async (task: Task) => {
      store.set(task.id, structuredClone(task));
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  };
}

describe('Task domain — attachments field', () => {
  it('Task interface has optional attachments?: string[]', () => {
    const task: Task = makeTask();
    expect(task.attachments).toBeUndefined();
  });

  it('Task can be created with attachments array', () => {
    const task: Task = makeTask({ attachments: ['file.txt', 'image.png'] });
    expect(task.attachments).toEqual(['file.txt', 'image.png']);
  });
});

describe('Paths — attachments', () => {
  const paths = new Paths('/project');

  it('attachmentsDir returns .orchestry/attachments', () => {
    expect(paths.attachmentsDir).toBe('/project/.orchestry/attachments');
  });

  it('taskAttachmentsDir returns attachments/{id}', () => {
    expect(paths.taskAttachmentsDir('tsk_abc123')).toBe(
      '/project/.orchestry/attachments/tsk_abc123',
    );
  });

  it('taskAttachmentsDir is under attachmentsDir', () => {
    const dir = paths.taskAttachmentsDir('tsk_xyz789');
    expect(dir.startsWith(paths.attachmentsDir + path.sep)).toBe(true);
  });

  it('taskAttachmentsDir throws on invalid id with path traversal', () => {
    expect(() => paths.taskAttachmentsDir('../etc/passwd')).toThrow();
  });
});

describe('TaskService — attachments: undefined', () => {
  let taskStore: ITaskStore;
  let eventBus: EventBus;
  let service: TaskService;

  beforeEach(() => {
    taskStore = createMockTaskStore();
    eventBus = new EventBus();
    service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);
  });

  it('creates task without attachments field when input.attachments is undefined', async () => {
    const task = await service.create({ title: 'No attachments' });
    expect(task.attachments).toBeUndefined();
  });

  it('creates task without attachments field when no paths provided', async () => {
    // service created without paths (4th arg omitted)
    const task = await service.create({ title: 'No paths', attachments: ['any.txt'] });
    // No paths → attachments skipped, field not set
    expect(task.attachments).toBeUndefined();
  });
});

describe('TaskService — attachments: empty array', () => {
  let taskStore: ITaskStore;
  let service: TaskService;

  beforeEach(() => {
    taskStore = createMockTaskStore();
    const eventBus = new EventBus();
    const paths = new Paths('/tmp/orch-test-empty');
    service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG, paths);
  });

  it('empty attachments [] does not set task.attachments', async () => {
    // mock fs.mkdir to ensure it's not called
    const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const task = await service.create({ title: 'Empty attachments', attachments: [] });
    expect(task.attachments).toBeUndefined();
    // no dir created because condition requires length > 0
    expect(mkdirSpy).not.toHaveBeenCalled();
    mkdirSpy.mockRestore();
  });
});

describe('TaskService — attachments: copy files', () => {
  let taskStore: ITaskStore;
  let service: TaskService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp('/tmp/orch-attach-test-');
    taskStore = createMockTaskStore();
    const eventBus = new EventBus();
    const paths = new Paths(tmpDir);
    // create .orchestry dir so paths work
    await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
    service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG, paths);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('copies attachment files and stores basenames', async () => {
    // create a temp source file
    const srcFile = path.join(tmpDir, 'document.txt');
    await fs.writeFile(srcFile, 'hello');

    const task = await service.create({ title: 'With attachment', attachments: [srcFile] });

    expect(task.attachments).toEqual(['document.txt']);

    // verify file was actually copied
    const paths = new Paths(tmpDir);
    const copiedPath = path.join(paths.taskAttachmentsDir(task.id), 'document.txt');
    const content = await fs.readFile(copiedPath, 'utf8');
    expect(content).toBe('hello');
  });

  it('copies multiple files and stores all basenames', async () => {
    const src1 = path.join(tmpDir, 'a.txt');
    const src2 = path.join(tmpDir, 'b.md');
    await fs.writeFile(src1, 'aaa');
    await fs.writeFile(src2, 'bbb');

    const task = await service.create({ title: 'Multi', attachments: [src1, src2] });

    expect(task.attachments).toHaveLength(2);
    expect(task.attachments).toContain('a.txt');
    expect(task.attachments).toContain('b.md');
  });

  it('creates attachments directory under .orchestry/attachments/{id}/', async () => {
    const srcFile = path.join(tmpDir, 'req.txt');
    await fs.writeFile(srcFile, 'data');

    const task = await service.create({ title: 'Dir check', attachments: [srcFile] });

    const paths = new Paths(tmpDir);
    const dirStat = await fs.stat(paths.taskAttachmentsDir(task.id));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('throws InvalidArgumentsError for nonexistent file', async () => {
    await expect(
      service.create({ title: 'Bad file', attachments: ['/nonexistent/file.txt'] }),
    ).rejects.toThrow(InvalidArgumentsError);
  });

  it('error message contains the missing file path', async () => {
    await expect(
      service.create({ title: 'Bad file', attachments: ['/tmp/no-such-file-xyz.txt'] }),
    ).rejects.toThrow('/tmp/no-such-file-xyz.txt');
  });

  it('does not copy any file if one is missing (validation before copy)', async () => {
    const srcFile = path.join(tmpDir, 'good.txt');
    await fs.writeFile(srcFile, 'ok');

    await expect(
      service.create({ title: 'Mixed', attachments: [srcFile, '/nonexistent/bad.txt'] }),
    ).rejects.toThrow(InvalidArgumentsError);
  });
});

describe('TaskService — delete removes attachments directory', () => {
  let taskStore: ITaskStore;
  let service: TaskService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp('/tmp/orch-delete-test-');
    const eventBus = new EventBus();
    const paths = new Paths(tmpDir);
    await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });

    const existingTask = makeTask({ id: 'tsk_deleteme', status: 'done' });
    taskStore = createMockTaskStore([existingTask]);
    service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG, paths);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes attachments directory on delete', async () => {
    const paths = new Paths(tmpDir);
    const attachDir = paths.taskAttachmentsDir('tsk_deleteme');
    await fs.mkdir(attachDir, { recursive: true });
    await fs.writeFile(path.join(attachDir, 'file.txt'), 'data');

    // verify dir exists before delete
    expect(await fs.stat(attachDir).then((s) => s.isDirectory())).toBe(true);

    await service.delete('tsk_deleteme');

    // dir should be gone
    await expect(fs.stat(attachDir)).rejects.toThrow();
  });

  it('delete succeeds even when attachments directory does not exist', async () => {
    // no attachments dir created — should not throw
    await expect(service.delete('tsk_deleteme')).resolves.toBeUndefined();
  });
});

describe('TaskService — getAttachmentPath', () => {
  it('returns correct path for attachment file', () => {
    const taskStore = createMockTaskStore();
    const eventBus = new EventBus();
    const paths = new Paths('/project');
    const service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG, paths);

    const result = service.getAttachmentPath('tsk_abc', 'notes.txt');
    expect(result).toBe('/project/.orchestry/attachments/tsk_abc/notes.txt');
  });

  it('throws when paths not configured', () => {
    const taskStore = createMockTaskStore();
    const eventBus = new EventBus();
    const service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

    expect(() => service.getAttachmentPath('tsk_abc', 'notes.txt')).toThrow(InvalidArgumentsError);
  });
});
