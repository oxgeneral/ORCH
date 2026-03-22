/**
 * Tests for scripts/postinstall.cjs banner behavior.
 *
 * Verifies:
 * 1) Star CTA line appears after 'orch' command in source (TTY mode content)
 * 2) Banner suppressed in CI (process.env.CI set)
 * 3) Banner suppressed in non-TTY (stderr not a TTY — default for piped child process)
 * 4) dim() ANSI helper uses code 240 matching src/cli/output.ts
 * 5) GitHub link is correct
 */
import { describe, it, expect } from 'vitest';
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT = resolve(process.cwd(), 'scripts/postinstall.cjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

// ---------------------------------------------------------------------------
// Source-level checks (no subprocess needed)
// ---------------------------------------------------------------------------

describe('postinstall.cjs — source content', () => {
  it('contains correct GitHub link', () => {
    expect(SOURCE).toContain('https://github.com/oxgeneral/ORCH');
  });

  it('star CTA appears after $ orch command', () => {
    const orchIdx = SOURCE.indexOf("bold('orch')");
    const ctaIdx = SOURCE.indexOf('https://github.com/oxgeneral/ORCH');
    expect(orchIdx).toBeGreaterThan(-1);
    expect(ctaIdx).toBeGreaterThan(-1);
    // CTA must come after the orch command line
    expect(ctaIdx).toBeGreaterThan(orchIdx);
  });

  it('dim() uses ANSI code 240 matching output.ts colors map', () => {
    // The dim function must use code 240 (same as output.ts dim color)
    expect(SOURCE).toMatch(/dim\s*=\s*\(s\)\s*=>\s*`\\x1b\[38;5;240m/);
  });

  it('star CTA is wrapped with dim()', () => {
    // The GitHub star line must use the dim() helper
    expect(SOURCE).toMatch(/dim\([^)]*https:\/\/github\.com\/oxgeneral\/ORCH/);
  });

  it('banner guard checks process.env.CI', () => {
    expect(SOURCE).toContain('process.env.CI');
  });

  it('banner guard checks process.stderr.isTTY', () => {
    expect(SOURCE).toContain('process.stderr.isTTY');
  });

  it('guard exits early — both CI and non-TTY on same line', () => {
    // The guard must combine CI and non-TTY with OR before process.exit
    expect(SOURCE).toMatch(/process\.env\.CI.*\|\|.*isTTY.*process\.exit/s);
  });
});

// ---------------------------------------------------------------------------
// Runtime behavior — CI suppression
// ---------------------------------------------------------------------------

describe('postinstall.cjs — CI suppression', () => {
  it('exits 0 without banner output when CI=1', () => {
    const result = spawnSync('node', [SCRIPT], {
      env: { ...process.env, CI: '1' },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('exits 0 without banner output when CI=true', () => {
    const result = spawnSync('node', [SCRIPT], {
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Runtime behavior — non-TTY suppression
// ---------------------------------------------------------------------------

describe('postinstall.cjs — non-TTY suppression', () => {
  it('exits 0 without banner when stderr is piped (non-TTY)', () => {
    // spawnSync with pipe stdio → stderr.isTTY is undefined (falsy)
    const result = spawnSync('node', [SCRIPT], {
      // Explicitly omit CI to test non-TTY path independently
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k !== 'CI'),
      ),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    // No banner written to stderr when not a TTY
    expect(result.stderr).toBe('');
  });
});
