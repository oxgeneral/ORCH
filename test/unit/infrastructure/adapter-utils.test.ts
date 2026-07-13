import { describe, it, expect } from 'vitest';
import { buildFullPrompt, buildChildEnv } from '../../../src/infrastructure/adapters/utils.js';

describe('buildFullPrompt', () => {
  it('returns userPrompt when systemPrompt is undefined', () => {
    expect(buildFullPrompt(undefined, 'do the task')).toBe('do the task');
  });

  it('returns userPrompt when systemPrompt is empty string', () => {
    expect(buildFullPrompt('', 'do the task')).toBe('do the task');
  });

  it('prepends systemPrompt with double newline separator', () => {
    expect(buildFullPrompt('be helpful', 'do the task')).toBe('be helpful\n\ndo the task');
  });

  it('preserves multi-line systemPrompt', () => {
    const sys = 'You are Backend A.\n## Rules\n- No any';
    const user = 'Fix the bug';
    expect(buildFullPrompt(sys, user)).toBe(sys + '\n\n' + user);
  });

  it('preserves multi-line userPrompt', () => {
    const user = '## Task: Fix bug\nDescription: crash on startup\nPriority: 1';
    expect(buildFullPrompt('system', user)).toBe('system\n\n' + user);
  });

  it('uses exactly two newlines as separator (not more)', () => {
    const result = buildFullPrompt('sys', 'usr');
    const sep = result.slice('sys'.length, result.length - 'usr'.length);
    expect(sep).toBe('\n\n');
  });
});

describe('buildChildEnv', () => {
  it('keeps safe explicit metadata variables', () => {
    const env = buildChildEnv({ ORCH_TASK_ID: 'tsk_1', CUSTOM_SAFE: 'ok' });

    expect(env['ORCH_TASK_ID']).toBe('tsk_1');
    expect(env['CUSTOM_SAFE']).toBe('ok');
  });

  it('blocks explicit PATH and runtime injection variables', () => {
    const env = buildChildEnv({
      PATH: '/tmp/evil',
      NODE_PATH: './node_modules',
      NODE_OPTIONS: '--require ./payload.js',
      BASH_ENV: './payload.sh',
      DYLD_INSERT_LIBRARIES: './evil.dylib',
      LD_PRELOAD: './evil.so',
      GIT_CONFIG_GLOBAL: './gitconfig',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.sshCommand',
      GIT_CONFIG_VALUE_0: './payload',
      GIT_SSH_COMMAND: './payload',
      SSH_ASKPASS: './askpass',
      PYTHONPATH: './python',
      RUBYOPT: '-r./payload',
      NPM_CONFIG_USERCONFIG: './npmrc',
      NPM_CONFIG_GLOBALCONFIG: './global-npmrc',
      NPM_CONFIG_SCRIPT_SHELL: './shell',
      SAFE_NAME: 'safe',
    });

    expect(env['PATH']).not.toBe('/tmp/evil');
    expect(env['NODE_PATH']).toBeUndefined();
    expect(env['NODE_OPTIONS']).toBeUndefined();
    expect(env['BASH_ENV']).toBeUndefined();
    expect(env['DYLD_INSERT_LIBRARIES']).toBeUndefined();
    expect(env['LD_PRELOAD']).toBeUndefined();
    expect(env['GIT_CONFIG_GLOBAL']).toBeUndefined();
    expect(env['GIT_CONFIG_COUNT']).toBeUndefined();
    expect(env['GIT_CONFIG_KEY_0']).toBeUndefined();
    expect(env['GIT_CONFIG_VALUE_0']).toBeUndefined();
    expect(env['GIT_SSH_COMMAND']).toBeUndefined();
    expect(env['SSH_ASKPASS']).toBeUndefined();
    expect(env['PYTHONPATH']).toBeUndefined();
    expect(env['RUBYOPT']).toBeUndefined();
    expect(env['NPM_CONFIG_USERCONFIG']).toBeUndefined();
    expect(env['NPM_CONFIG_GLOBALCONFIG']).toBeUndefined();
    expect(env['NPM_CONFIG_SCRIPT_SHELL']).toBeUndefined();
    expect(env['SAFE_NAME']).toBe('safe');
  });
});
