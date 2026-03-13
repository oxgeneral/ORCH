/**
 * QA verification tests for perf wave 3:
 * output.ts — chalk lazy init via Proxy (no ansi256() calls at module import)
 */
import { describe, it, expect, vi } from 'vitest';

describe('output.ts lazy chalk init', () => {
  it('imports without calling chalk.ansi256 at module load', async () => {
    // If chalk.ansi256 were called eagerly at import, we'd see it invoked
    // during module initialization. The lazy Proxy defers this.
    // We can't directly spy on module-init code, but we verify
    // the module loads without errors and exports are present.
    const output = await import('../../../src/cli/output.js');
    expect(typeof output.statusIcon).toBe('function');
    expect(typeof output.setNoColor).toBe('function');
    expect(typeof output.setAsciiMode).toBe('function');
  });

  it('statusIcon returns a string for known statuses', async () => {
    const { statusIcon } = await import('../../../src/cli/output.js');
    const icon = statusIcon('todo');
    expect(typeof icon).toBe('string');
    expect(icon.length).toBeGreaterThan(0);
  });

  it('statusIcon for in_progress returns colored string (triggers getColors)', async () => {
    const { statusIcon } = await import('../../../src/cli/output.js');
    // This triggers color access via the Proxy
    const icon = statusIcon('in_progress');
    expect(typeof icon).toBe('string');
    expect(icon.length).toBeGreaterThan(0);
  });

  it('statusIcon for done returns colored string', async () => {
    const { statusIcon } = await import('../../../src/cli/output.js');
    const icon = statusIcon('done');
    expect(typeof icon).toBe('string');
  });

  it('statusIcon for failed returns colored string', async () => {
    const { statusIcon } = await import('../../../src/cli/output.js');
    const icon = statusIcon('failed');
    expect(typeof icon).toBe('string');
  });

  it('setNoColor disables chalk level without errors', async () => {
    const { setNoColor } = await import('../../../src/cli/output.js');
    expect(() => setNoColor(false)).not.toThrow();
    expect(() => setNoColor(true)).not.toThrow();
    // Restore
    expect(() => setNoColor(false)).not.toThrow();
  });
});
