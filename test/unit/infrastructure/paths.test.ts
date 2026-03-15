import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { Paths, sanitizeId, validateWorkspacePath, findProjectRoot, clearProjectRootCache } from '../../../src/infrastructure/storage/paths.js';

describe('Paths', () => {
  const root = '/projects/myapp';
  const paths = new Paths(root);

  it('resolves root .orchestry/ directory', () => {
    expect(paths.root).toBe(path.join(root, '.orchestry'));
  });

  it('resolves config path', () => {
    expect(paths.configPath).toBe(path.join(root, '.orchestry', 'config.yml'));
  });

  it('resolves state path', () => {
    expect(paths.statePath).toBe(path.join(root, '.orchestry', 'state.json'));
  });

  it('resolves lock path', () => {
    expect(paths.lockPath).toBe(path.join(root, '.orchestry', 'orchestry.lock'));
  });

  it('resolves task path with sanitized ID', () => {
    expect(paths.taskPath('tsk_abc')).toBe(
      path.join(root, '.orchestry', 'tasks', 'tsk_abc.yml'),
    );
  });

  it('resolves agent path', () => {
    expect(paths.agentPath('agt_1')).toBe(
      path.join(root, '.orchestry', 'agents', 'agt_1.yml'),
    );
  });

  it('resolves run path (JSON)', () => {
    expect(paths.runPath('run_x')).toBe(
      path.join(root, '.orchestry', 'runs', 'run_x.json'),
    );
  });

  it('resolves run events path (JSONL)', () => {
    expect(paths.runEventsPath('run_x')).toBe(
      path.join(root, '.orchestry', 'runs', 'run_x.jsonl'),
    );
  });

  it('resolves default template path', () => {
    expect(paths.defaultTemplatePath()).toBe(
      path.join(root, '.orchestry', 'templates', 'default.md'),
    );
  });

  it('resolves messagesDir', () => {
    expect(paths.messagesDir).toBe(path.join(root, '.orchestry', 'messages'));
  });

  it('resolves messagePath with sanitized ID', () => {
    expect(paths.messagePath('msg_abc123')).toBe(
      path.join(root, '.orchestry', 'messages', 'msg_abc123.json'),
    );
  });

  it('resolves teamsDir', () => {
    expect(paths.teamsDir).toBe(path.join(root, '.orchestry', 'teams'));
  });

  it('resolves teamPath with sanitized ID', () => {
    expect(paths.teamPath('team_xyz')).toBe(
      path.join(root, '.orchestry', 'teams', 'team_xyz.yml'),
    );
  });
});

describe('sanitizeId', () => {
  it('passes through valid IDs unchanged', () => {
    expect(sanitizeId('tsk_abc-123.v1')).toBe('tsk_abc-123.v1');
  });

  it('rejects IDs with path separators', () => {
    expect(() => sanitizeId('hello/world')).toThrow('Invalid identifier');
    expect(() => sanitizeId('../etc/passwd')).toThrow('Invalid identifier');
  });

  it('rejects IDs with slashes only', () => {
    expect(() => sanitizeId('///')).toThrow('Invalid identifier');
  });

  it('rejects IDs with spaces', () => {
    expect(() => sanitizeId('hello world')).toThrow('Invalid identifier');
  });

  it('rejects empty string', () => {
    expect(() => sanitizeId('')).toThrow('Invalid identifier');
  });
});

describe('findProjectRoot cache', () => {
  beforeEach(() => {
    clearProjectRootCache();
  });

  it('returns same result on repeated calls (cache hit)', () => {
    const result1 = findProjectRoot(process.cwd());
    const result2 = findProjectRoot(process.cwd());
    expect(result1).toBe(result2);
  });

  it('clearProjectRootCache resets cache so next call traverses again', () => {
    const result1 = findProjectRoot(process.cwd());
    clearProjectRootCache();
    const result2 = findProjectRoot(process.cwd());
    // Same result but was actually re-computed
    expect(result1).toBe(result2);
  });

  it('caches different startDir values independently', () => {
    const result1 = findProjectRoot('/');
    const result2 = findProjectRoot(process.cwd());
    // Root dir has no .orchestry, so returns '/'
    expect(result1).toBe('/');
    // cwd should find project root or return cwd
    expect(typeof result2).toBe('string');
  });
});

describe('validateWorkspacePath', () => {
  it('accepts paths within project root', () => {
    expect(() => validateWorkspacePath('/proj/sub/dir', '/proj')).not.toThrow();
  });

  it('accepts exact project root', () => {
    expect(() => validateWorkspacePath('/proj', '/proj')).not.toThrow();
  });

  it('rejects paths outside project root', () => {
    expect(() => validateWorkspacePath('/other/dir', '/proj')).toThrow('outside project root');
  });

  it('rejects path traversal', () => {
    expect(() => validateWorkspacePath('/proj/../etc', '/proj')).toThrow('outside project root');
  });
});
