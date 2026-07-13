/**
 * Path resolution for .orchestry/ directory.
 *
 * All path construction goes through this module.
 * Validates initialization state and sanitizes identifiers.
 */

import path from 'node:path';
import { accessSync } from 'node:fs';
import fs from 'node:fs/promises';
import { NotInitializedError } from '../../domain/errors.js';
import { pathExists } from './fs-utils.js';

export const ORCHESTRY_DIR = '.orchestry';
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export class Paths {
  constructor(private readonly projectRoot: string) {}

  /** Root .orchestry/ directory */
  get root(): string {
    return path.join(this.projectRoot, ORCHESTRY_DIR);
  }

  get configPath(): string {
    return path.join(this.root, 'config.yml');
  }

  get statePath(): string {
    return path.join(this.root, 'state.json');
  }

  get lockPath(): string {
    return path.join(this.root, 'orchestry.lock');
  }

  get tasksDir(): string {
    return path.join(this.root, 'tasks');
  }

  get agentsDir(): string {
    return path.join(this.root, 'agents');
  }

  get runsDir(): string {
    return path.join(this.root, 'runs');
  }

  get templatesDir(): string {
    return path.join(this.root, 'templates');
  }

  get logsDir(): string {
    return path.join(this.root, 'logs');
  }

  get contextDir(): string {
    return path.join(this.root, 'context');
  }

  contextPath(key: string): string {
    return path.join(this.contextDir, `${sanitizeId(key)}.json`);
  }

  get messagesDir(): string {
    return path.join(this.root, 'messages');
  }

  messagePath(id: string): string {
    return path.join(this.messagesDir, `${sanitizeId(id)}.json`);
  }

  get goalsDir(): string {
    return path.join(this.root, 'goals');
  }

  goalPath(id: string): string {
    return path.join(this.goalsDir, `${sanitizeId(id)}.yml`);
  }

  get teamsDir(): string {
    return path.join(this.root, 'teams');
  }

  get attachmentsDir(): string {
    return path.join(this.root, 'attachments');
  }

  taskAttachmentsDir(taskId: string): string {
    return path.join(this.attachmentsDir, sanitizeId(taskId));
  }

  teamPath(id: string): string {
    return path.join(this.teamsDir, `${sanitizeId(id)}.yml`);
  }

  get gitignorePath(): string {
    return path.join(this.root, '.gitignore');
  }

  get workspaceExcludePath(): string {
    return path.join(this.root, 'workspace-exclude');
  }

  taskPath(id: string): string {
    return path.join(this.tasksDir, `${sanitizeId(id)}.yml`);
  }

  agentPath(id: string): string {
    return path.join(this.agentsDir, `${sanitizeId(id)}.yml`);
  }

  runPath(id: string): string {
    return path.join(this.runsDir, `${sanitizeId(id)}.json`);
  }

  runEventsPath(id: string): string {
    return path.join(this.runsDir, `${sanitizeId(id)}.jsonl`);
  }

  defaultTemplatePath(): string {
    return path.join(this.templatesDir, 'default.md');
  }

  async isInitialized(): Promise<boolean> {
    return pathExists(this.root);
  }

  async requireInit(): Promise<void> {
    if (!(await this.isInitialized())) {
      throw new NotInitializedError();
    }
    await this.validateStateRoot();
  }

  async validateStateRoot(): Promise<void> {
    const expected = path.resolve(this.root);
    const stat = await fs.lstat(expected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe .orchestry directory: ${expected}`);
    }
    const realRoot = await fs.realpath(expected);
    const realProjectRoot = await fs.realpath(this.projectRoot);
    const relative = path.relative(realProjectRoot, realRoot);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Unsafe .orchestry directory location: ${expected}`);
    }
    await fs.chmod(expected, 0o700).catch(() => {});
  }
}

/**
 * Validate an identifier for use in file paths.
 * Only allows [A-Za-z0-9._-] characters.
 * Rejects identifiers containing forbidden characters (path separators, etc.)
 * to prevent path traversal attacks.
 */
export function sanitizeId(id: string): string {
  if (id === '.' || id === '..') {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  return id;
}

/**
 * Validate that a workspace path is within the project root.
 * Prevents path traversal attacks.
 */
export function validateWorkspacePath(workspacePath: string, projectRoot: string): void {
  const resolved = path.resolve(workspacePath);
  const root = path.resolve(projectRoot);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Workspace path "${workspacePath}" is outside project root`);
  }
}

/**
 * Module-level cache for findProjectRoot().
 * Key: resolved startDir, Value: found project root.
 * Avoids repeated accessSync() traversals on every CLI invocation.
 */
const projectRootCache = new Map<string, string>();

/**
 * Resolve project root by walking up from cwd looking for .orchestry/.
 * Returns cwd if not found (for init command).
 *
 * Results are cached per startDir to avoid redundant filesystem traversals.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  const resolvedStart = path.resolve(startDir);
  const cached = projectRootCache.get(resolvedStart);
  if (cached !== undefined) return cached;

  let dir = resolvedStart;
  const root = path.parse(dir).root;

  while (dir !== root) {
    try {
      accessSync(path.join(dir, '.orchestry'));
      projectRootCache.set(resolvedStart, dir);
      return dir;
    } catch {
      // Not found, go up
    }
    dir = path.dirname(dir);
  }

  // Not found — return resolved dir (for init command)
  projectRootCache.set(resolvedStart, resolvedStart);
  return resolvedStart;
}

/**
 * Clear the findProjectRoot cache.
 * Useful in tests or after `orch init` changes the project structure.
 */
export function clearProjectRootCache(): void {
  projectRootCache.clear();
}
