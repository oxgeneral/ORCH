import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerConfigCommand } from '../../../src/cli/commands/config.js';
import { makeContainer } from './helpers.js';

describe('config command', () => {
  let program: Command;
  let container: Container;

  beforeEach(() => {
    delete process.env['ORCH_ALLOW_SECURITY_CONFIG_WRITE'];
    process.exitCode = undefined;
    program = new Command();
    program.exitOverride();
    container = makeContainer();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerConfigCommand(program, container);
  });

  afterEach(() => {
    delete process.env['ORCH_ALLOW_SECURITY_CONFIG_WRITE'];
    process.exitCode = undefined;
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

    it('refuses security-sensitive keys by default', async () => {
      await program.parseAsync(['config', 'set', 'execution.security.allow_shell_adapter', 'true'], { from: 'user' });

      expect(container.configStore.set).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('allows security-sensitive keys with explicit environment unlock', async () => {
      process.env['ORCH_ALLOW_SECURITY_CONFIG_WRITE'] = '1';

      await program.parseAsync(['config', 'set', 'execution.security.allow_permission_bypass', 'true'], { from: 'user' });

      expect(container.configStore.set).toHaveBeenCalledWith('execution.security.allow_permission_bypass', true);
    });

    it('refuses parent object writes that include security-sensitive keys', async () => {
      await program.parseAsync([
        'config',
        'set',
        'execution',
        '{"security":{"allow_shell_adapter":true}}',
      ], { from: 'user' });

      expect(container.configStore.set).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });
});
