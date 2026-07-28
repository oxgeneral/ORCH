import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerContextCommand } from '../../../src/cli/commands/context.js';
import type { ContextEntry } from '../../../src/infrastructure/storage/interfaces.js';
import { makeContainer } from './helpers.js';

const NOW = '2025-06-01T00:00:00Z';

function makeEntry(key: string, value: string, opts: Partial<ContextEntry> = {}): ContextEntry {
  return {
    key,
    value,
    created_at: NOW,
    updated_at: NOW,
    ...opts,
  };
}

describe('context command', () => {
  let program: Command;
  let container: Container;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    container = makeContainer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerContextCommand(program, container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('context set', () => {
    it('calls contextStore.set with key and value', async () => {
      await program.parseAsync(['context', 'set', 'mykey', 'myval'], { from: 'user' });

      expect(container.contextStore.set).toHaveBeenCalledWith('mykey', 'myval', undefined);
    });

    it('passes TTL when provided', async () => {
      await program.parseAsync(['context', 'set', 'k', 'v', '--ttl', '5000'], { from: 'user' });

      expect(container.contextStore.set).toHaveBeenCalledWith('k', 'v', 5000);
    });

    it('prints success message in normal mode', async () => {
      await program.parseAsync(['context', 'set', 'k', 'v'], { from: 'user' });

      expect(console.log).toHaveBeenCalled();
    });

    it('prints key in quiet mode', async () => {
      container = makeContainer({
        context: { json: false, quiet: true, noColor: false, ascii: false, projectRoot: '/tmp' },
      } as any);
      program = new Command();
      program.exitOverride();
      registerContextCommand(program, container);

      await program.parseAsync(['context', 'set', 'k', 'v'], { from: 'user' });

      expect((console.log as ReturnType<typeof vi.fn>).mock.calls.some(
        (c: any[]) => c[0] === 'k',
      )).toBe(true);
    });
  });

  describe('context get', () => {
    it('prints entry value when found', async () => {
      (container.contextStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeEntry('k', 'hello'),
      );

      await program.parseAsync(['context', 'get', 'k'], { from: 'user' });

      expect(console.log).toHaveBeenCalled();
    });

    it('prints error when key not found', async () => {
      (container.contextStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await program.parseAsync(['context', 'get', 'missing'], { from: 'user' });

      expect(console.error).toHaveBeenCalled();
    });

    it('prints null in JSON mode when key not found', async () => {
      container = makeContainer({
        context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' },
      } as any);
      program = new Command();
      program.exitOverride();
      registerContextCommand(program, container);

      await program.parseAsync(['context', 'get', 'missing'], { from: 'user' });

      expect((console.log as ReturnType<typeof vi.fn>).mock.calls.some(
        (c: any[]) => c[0] === 'null',
      )).toBe(true);
    });

    it('prints JSON when json mode is on and entry exists', async () => {
      container = makeContainer({
        context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' },
        contextStore: {
          ...makeContainer().contextStore,
          get: vi.fn(async () => makeEntry('k', 'val')),
        },
      } as any);
      program = new Command();
      program.exitOverride();
      registerContextCommand(program, container);

      await program.parseAsync(['context', 'get', 'k'], { from: 'user' });

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('prints value only in quiet mode', async () => {
      container = makeContainer({
        context: { json: false, quiet: true, noColor: false, ascii: false, projectRoot: '/tmp' },
        contextStore: {
          ...makeContainer().contextStore,
          get: vi.fn(async () => makeEntry('k', 'quietval')),
        },
      } as any);
      program = new Command();
      program.exitOverride();
      registerContextCommand(program, container);

      await program.parseAsync(['context', 'get', 'k'], { from: 'user' });

      expect((console.log as ReturnType<typeof vi.fn>).mock.calls.some(
        (c: any[]) => c[0] === 'quietval',
      )).toBe(true);
    });
  });

  describe('context list', () => {
    it('prints message when no entries', async () => {
      await program.parseAsync(['context', 'list'], { from: 'user' });

      expect(console.log).toHaveBeenCalled();
    });

    it('prints table when entries exist', async () => {
      (container.contextStore.list as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEntry('key1', 'val1'),
        makeEntry('key2', 'val2'),
      ]);

      await program.parseAsync(['context', 'list'], { from: 'user' });

      expect(console.log).toHaveBeenCalled();
    });

    it('truncates long values in table', async () => {
      (container.contextStore.list as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEntry('k', 'x'.repeat(100)),
      ]);

      await program.parseAsync(['context', 'list'], { from: 'user' });

      // The output should contain truncated value with '...'
      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: any[]) => String(c[0])).join('\n');
      // 50 chars max + '...' = value is truncated
      expect(allOutput).not.toContain('x'.repeat(100));
    });
  });

  describe('context delete', () => {
    it('calls contextStore.delete', async () => {
      await program.parseAsync(['context', 'delete', 'mykey'], { from: 'user' });

      expect(container.contextStore.delete).toHaveBeenCalledWith('mykey');
    });

    it('prints success in normal mode', async () => {
      await program.parseAsync(['context', 'delete', 'k'], { from: 'user' });

      expect(console.log).toHaveBeenCalled();
    });
  });
});
