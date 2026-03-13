import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';

const execFileMock = vi.fn();
const execFileSyncMock = vi.fn();
const mkdtempMock = vi.fn();
const readFileMock = vi.fn();
const unlinkMock = vi.fn().mockResolvedValue(undefined);
const rmMock = vi.fn().mockResolvedValue(undefined);
const writeFileMock = vi.fn().mockResolvedValue(undefined);

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: mkdtempMock,
  readFile: readFileMock,
  unlink: unlinkMock,
  rm: rmMock,
  writeFile: writeFileMock,
}));

function mockExecFileResolve(stdout: string | Buffer): void {
  execFileMock.mockImplementation(
    (_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof callback === 'function') {
        (callback as (err: null, result: { stdout: string | Buffer; stderr: string }) => void)(null, { stdout, stderr: '' });
      }
      return {} as ChildProcess;
    },
  );
}

function mockExecFileReject(): void {
  execFileMock.mockImplementation(
    (_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof callback === 'function') {
        (callback as (err: Error) => void)(new Error('command failed'));
      }
      return {} as ChildProcess;
    },
  );
}

function mockExecFileSequence(results: Array<{ stdout: string | Buffer } | { error: true }>): void {
  let callIndex = 0;
  execFileMock.mockImplementation(
    (_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      const entry = results[callIndex++];
      if (typeof callback === 'function') {
        if (entry && 'error' in entry) {
          (callback as (err: Error) => void)(new Error('failed'));
        } else {
          (callback as (err: null, result: { stdout: string | Buffer; stderr: string }) => void)(
            null,
            { stdout: entry?.stdout ?? '', stderr: '' },
          );
        }
      }
      return {} as ChildProcess;
    },
  );
}

describe('clipboard-service', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mkdtempMock.mockResolvedValue('/tmp/orch-clip-test');
    readFileMock.mockResolvedValue(Buffer.from('fake-png'));
    unlinkMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('isClipboardToolAvailable', () => {
    it('returns true on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(true);
    });

    it('returns true on linux when xclip is installed', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      execFileSyncMock.mockReturnValue(Buffer.from('/usr/bin/xclip'));
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(true);
    });

    it('returns false on linux when xclip is missing', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      execFileSyncMock.mockImplementation(() => { throw new Error('not found'); });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(false);
    });

    it('returns true on windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(true);
    });

    it('returns false on unsupported platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      const { isClipboardToolAvailable } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(isClipboardToolAvailable()).toBe(false);
    });
  });

  describe('detectClipboardType', () => {
    describe('macOS', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
      });

      it('detects PNG image', async () => {
        mockExecFileResolve('«class PNGf», 12345\n«class ut16», 0');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects TIFF image', async () => {
        mockExecFileResolve('«class TIFF», 12345');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects text (ut16)', async () => {
        mockExecFileResolve('«class ut16», 42');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('detects text (utf8)', async () => {
        mockExecFileResolve('«class utf8», 42');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('returns empty on error', async () => {
        mockExecFileReject();
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });

      it('returns empty for empty clipboard', async () => {
        mockExecFileResolve('');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });
    });

    describe('linux', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
      });

      it('detects image/png', async () => {
        mockExecFileResolve('TARGETS\nimage/png\ntext/plain');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects text/plain', async () => {
        mockExecFileResolve('TARGETS\ntext/plain\nUTF8_STRING');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('returns empty on error', async () => {
        mockExecFileReject();
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });
    });

    describe('windows', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
      });

      it('detects image', async () => {
        mockExecFileResolve('image');
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('image');
      });

      it('detects text', async () => {
        mockExecFileSequence([{ stdout: 'none' }, { stdout: 'text' }]);
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('text');
      });

      it('returns empty on error', async () => {
        mockExecFileReject();
        const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
        expect(await detectClipboardType()).toBe('empty');
      });
    });

    it('throws on unsupported platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      const { detectClipboardType } = await import('../../../src/infrastructure/clipboard-service.js');
      await expect(detectClipboardType()).rejects.toThrow('Unsupported platform');
    });
  });

  describe('getClipboardImage', () => {
    it('returns null when clipboard has text', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      mockExecFileResolve('«class ut16», 42');
      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(await getClipboardImage()).toBeNull();
    });

    it('returns null when clipboard is empty', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      mockExecFileResolve('');
      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      expect(await getClipboardImage()).toBeNull();
    });

    it('extracts image on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const pngData = Buffer.from('fake-png-data');

      mockExecFileSequence([
        { stdout: '«class PNGf», 12345' },  // detect
        { stdout: 'ok' },                    // osascript write PNG
      ]);
      readFileMock.mockResolvedValue(pngData);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();

      expect(result).not.toBeNull();
      expect(result!.ext).toBe('png');
      expect(result!.data).toEqual(pngData);
    });

    it('extracts image on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const pngData = Buffer.from('fake-png-data');

      mockExecFileSequence([
        { stdout: 'TARGETS\nimage/png' },  // detect
        { stdout: pngData },               // xclip -o image data
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();

      expect(result).not.toBeNull();
      expect(result!.ext).toBe('png');
    });

    it('returns null on macOS when osascript returns error string', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExecFileSequence([
        { stdout: '«class PNGf», 12345' },  // detect
        { stdout: 'error' },                 // osascript failed
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();
      expect(result).toBeNull();
    });

    it('returns null on linux when xclip returns empty buffer', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockExecFileSequence([
        { stdout: 'TARGETS\nimage/png' },
        { stdout: Buffer.alloc(0) },
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();
      expect(result).toBeNull();
    });

    it('cleans up temp files on macOS even on error', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExecFileSequence([
        { stdout: '«class PNGf», 12345' },  // detect
        { error: true },                      // osascript throws
      ]);

      const { getClipboardImage } = await import('../../../src/infrastructure/clipboard-service.js');
      const result = await getClipboardImage();
      expect(result).toBeNull();
      expect(rmMock).toHaveBeenCalledWith('/tmp/orch-clip-test', { recursive: true });
    });
  });
});
