/**
 * Path resolution for .orchestry/ directory.
 *
 * All path construction goes through this module.
 * Validates initialization state and sanitizes identifiers.
 */

import path from 'node:path';
import { accessSync } from 'node:fs';
import { NotInitializedError } from '../../domain/errors.js';
import { pathExists } from './fs-utils.js';

const ORCHESTRY_DIR = '.orchestry';
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

  get teamsDir(): string {
    return path.join(this.root, 'teams');
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
  }
}

/**
 * Sanitize an identifier for use in file paths.
 * Only allows [A-Za-z0-9._-] characters.
 */
export function sanitizeId(id: string): string {
  const sanitized = id.replace(/[^A-Za-z0-9._-]/g, '');
  if (sanitized.length === 0) {
    throw new Error(`Invalid identifier: "${id}"`);
  }
  return sanitized;
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
 * Resolve project root by walking up from cwd looking for .orchestry/.
 * Returns cwd if not found (for init command).
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    try {
      accessSync(path.join(dir, '.orchestry'));
      return dir;
    } catch {
      // Not found, go up
    }
    dir = path.dirname(dir);
  }

  // Not found — return original dir (for init command)
  return startDir;
}
