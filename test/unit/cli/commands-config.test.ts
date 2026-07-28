import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerConfigCommand } from '../../../src/cli/commands/config.js';
import { makeContainer } from './helpers.js';

describe('config command', () => {
  let program: Command;
  let container: Container;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    container = makeContainer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerConfigCommand(program, container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('config get', () => {
    it('calls configStore.get with key', async () => {
      await program.parseAsync(['config', 'get', 'scheduling.poll_interval_ms'], { from: 'user' });

      expect(container.configStore.get).toHaveBeenCalledWith('scheduling.poll_interval_ms');
      expect(console.log).toHaveBeenCalled();
    });

    it('outputs JSON when json mode is on', async () => {
      container = makeContainer({ context: { json: true, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' } } as any);
      program = new Command();
      program.exitOverride();
      registerConfigCommand(program, container);

      await program.parseAsync(['config', 'get', 'key'], { from: 'user' });

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('config set', () => {
    it('calls configStore.set with key and parsed JSON value', async () => {
      await program.parseAsync(['config', 'set', 'max_turns', '10'], { from: 'user' });

      expect(container.configStore.set).toHaveBeenCalledWith('max_turns', 10);
    });

    it('falls back to string when value is not valid JSON', async () => {
      await program.parseAsync(['config', 'set', 'name', 'hello-world'], { from: 'user' });

      expect(container.configStore.set).toHaveBeenCalledWith('name', 'hello-world');
    });

    it('parses boolean JSON values', async () => {
      await program.parseAsync(['config', 'set', 'flag', 'true'], { from: 'user' });

      expect(container.configStore.set).toHaveBeenCalledWith('flag', true);
    });
  });

  describe('config global', () => {
    it('persists a valid TUI palette', async () => {
      await program.parseAsync(['config', 'global', 'set', 'palette', 'light'], { from: 'user' });

      expect(container.globalConfigStore.set).toHaveBeenCalledWith('palette', 'light');
    });

    it('rejects an unknown TUI palette', async () => {
      await program.parseAsync(['config', 'global', 'set', 'palette', 'solarized'], { from: 'user' });

      expect(container.globalConfigStore.set).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Valid: amber, ocean, forest, violet, light'));
    });

    it('reads the current TUI palette', async () => {
      await program.parseAsync(['config', 'global', 'get', 'palette'], { from: 'user' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"amber"'));
    });
  });
});
