import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import * as childProcess from 'node:child_process';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn() };
});

describe('ProcessManager', () => {
  let manager: ProcessManager;

  beforeEach(() => {
    manager = new ProcessManager();
    vi.clearAllMocks();
  });

  describe('spawn', () => {
    it('calls proc.unref() after detached spawn to allow parent exit', () => {
      const mockUnref = vi.fn();
      const mockProc = {
        pid: 12345,
        stdout: null,
        stderr: null,
        unref: mockUnref,
      };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);

      manager.spawn('echo', ['hello']);

      expect(mockUnref).toHaveBeenCalledOnce();
    });

    it('spawns with detached:true so process group kill works', () => {
      const mockProc = { pid: 12345, stdout: null, stderr: null, unref: vi.fn() };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);

      manager.spawn('echo', ['hello']);

      const spawnOpts = vi.mocked(childProcess.spawn).mock.calls[0][2];
      expect(spawnOpts?.detached).toBe(true);
    });

    it('throws if process has no pid', () => {
      const mockProc = { pid: undefined, unref: vi.fn() };
      vi.mocked(childProcess.spawn).mockReturnValue(mockProc as any);

      expect(() => manager.spawn('bad-cmd', [])).toThrow('Failed to spawn process');
    });
  });
});
