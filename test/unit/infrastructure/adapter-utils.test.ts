import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  buildFullPrompt,
  createStderrTailCapture,
} from '../../../src/infrastructure/adapters/utils.js';

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

describe('createStderrTailCapture', () => {
  it('drains stderr and retains only the last 4 KB', () => {
    const stderr = new PassThrough();
    const getTail = createStderrTailCapture(stderr);
    const suffix = 'ACTIONABLE_ERROR';

    stderr.write('x'.repeat(5000) + suffix);

    const tail = getTail();
    expect(Buffer.byteLength(tail, 'utf-8')).toBeLessThanOrEqual(4096);
    expect(tail).toHaveLength(4096);
    expect(tail.endsWith(suffix)).toBe(true);
  });

  it('returns an empty tail when stderr is unavailable', () => {
    expect(createStderrTailCapture(null)()).toBe('');
  });
});
