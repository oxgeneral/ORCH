import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { npmEnv, runInstall } from '../../../src/cli/commands/update.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => {
    const child = new EventEmitter() as EventEmitter & { stdout?: EventEmitter; stderr?: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.pipe = vi.fn();
    child.stderr.pipe = vi.fn();
    queueMicrotask(() => cb(null, '', ''));
    return child;
  }),
}));

describe('update command helpers', () => {
  afterEach(() => {
    delete process.env['NPM_CONFIG_USERCONFIG'];
    delete process.env['NPM_CONFIG_GLOBALCONFIG'];
    delete process.env['NPM_CONFIG_REGISTRY'];
    vi.clearAllMocks();
  });

  it('builds an isolated npm environment', () => {
    process.env['NPM_CONFIG_USERCONFIG'] = '/tmp/host-user.npmrc';
    process.env['NPM_CONFIG_GLOBALCONFIG'] = '/tmp/host-global.npmrc';
    process.env['NPM_CONFIG_REGISTRY'] = 'https://evil.invalid/';

    const env = npmEnv();

    expect(env['NPM_CONFIG_REGISTRY']).toBe('https://registry.npmjs.org/');
    expect(env['NPM_CONFIG_USERCONFIG']).toContain('empty-user.npmrc');
    expect(env['NPM_CONFIG_GLOBALCONFIG']).toContain('empty-global.npmrc');
    expect(env['NPM_CONFIG_USERCONFIG']).not.toBe('/tmp/host-user.npmrc');
    expect(env['NPM_CONFIG_GLOBALCONFIG']).not.toBe('/tmp/host-global.npmrc');
  });

  it('runs npm install with fixed package, version, registry, and isolated env', async () => {
    await expect(runInstall('1.2.3')).resolves.toEqual({ code: 0, output: '' });

    expect(execFile).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', '@oxgeneral/orch@1.2.3', '--registry', 'https://registry.npmjs.org/'],
      expect.objectContaining({
        cwd: expect.any(String),
        env: expect.objectContaining({
          NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
          NPM_CONFIG_USERCONFIG: expect.stringContaining('empty-user.npmrc'),
          NPM_CONFIG_GLOBALCONFIG: expect.stringContaining('empty-global.npmrc'),
        }),
        timeout: 60_000,
      }),
      expect.any(Function),
    );
  });
});
