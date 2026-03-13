/**
 * Tests for createContext — verifies NO_COLOR env var check uses 'in' operator.
 * Covers P3 fix: NO_COLOR presence (not value) disables color output.
 * Per https://no-color.org/ spec: any value of NO_COLOR disables color.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createContext } from '../../../src/cli/context.js';

// Mock findProjectRoot to avoid filesystem access
vi.mock('../../../src/infrastructure/storage/paths.js', () => ({
  findProjectRoot: vi.fn(() => '/tmp/test-project'),
}));

describe('createContext — NO_COLOR env var', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clone process.env to avoid mutation across tests
    process.env = { ...originalEnv };
    delete process.env['NO_COLOR'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('noColor is false when NO_COLOR is not set', () => {
    const ctx = createContext({});
    expect(ctx.noColor).toBe(false);
  });

  it('noColor is true when NO_COLOR is set to empty string', () => {
    process.env['NO_COLOR'] = '';
    const ctx = createContext({});
    expect(ctx.noColor).toBe(true);
  });

  it('noColor is true when NO_COLOR is set to "1"', () => {
    process.env['NO_COLOR'] = '1';
    const ctx = createContext({});
    expect(ctx.noColor).toBe(true);
  });

  it('noColor is true when NO_COLOR is set to "0" (presence check, not truthiness)', () => {
    process.env['NO_COLOR'] = '0';
    const ctx = createContext({});
    // Per NO_COLOR spec: any value including "0" disables color
    expect(ctx.noColor).toBe(true);
  });

  it('noColor is true when opts.noColor is true regardless of env', () => {
    const ctx = createContext({ noColor: true });
    expect(ctx.noColor).toBe(true);
  });

  it('noColor remains false when opts.noColor is false and NO_COLOR not set', () => {
    const ctx = createContext({ noColor: false });
    expect(ctx.noColor).toBe(false);
  });

  it('opts.noColor=false still obeys NO_COLOR env if set', () => {
    process.env['NO_COLOR'] = 'true';
    const ctx = createContext({ noColor: false });
    // env wins because of || short-circuit: false || ('NO_COLOR' in env)
    expect(ctx.noColor).toBe(true);
  });
});

describe('createContext — other fields', () => {
  it('json defaults to false', () => {
    const ctx = createContext({});
    expect(ctx.json).toBe(false);
  });

  it('json set to true', () => {
    const ctx = createContext({ json: true });
    expect(ctx.json).toBe(true);
  });

  it('quiet defaults to false', () => {
    const ctx = createContext({});
    expect(ctx.quiet).toBe(false);
  });

  it('projectRoot is populated', () => {
    const ctx = createContext({});
    expect(typeof ctx.projectRoot).toBe('string');
    expect(ctx.projectRoot.length).toBeGreaterThan(0);
  });
});
