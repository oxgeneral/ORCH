/**
 * Skill Library loader.
 *
 * Resolves agent skill names to Markdown content from the bundled
 * `skills/library/` directory. Skills containing ':' are Claude Code
 * MCP skills — handled natively by Claude CLI, skipped here.
 *
 * Content is cached in-process for the lifetime of the SkillLoader instance.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listFiles, pathExists } from '../storage/fs-utils.js';

/** Valid skill name: lowercase alphanumeric + hyphens only. */
const VALID_SKILL_NAME = /^[a-z0-9-]+$/;

/**
 * Resolve the skills/library/ directory relative to the package root.
 * Works in both dev mode (src/infrastructure/skills/) and production (dist/).
 */
async function resolveLibraryDir(): Promise<string> {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Walk up from current file until we find skills/library/
  let dir = thisDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'skills', 'library');
    if (await pathExists(candidate)) return candidate;
    dir = dirname(dir);
  }

  // Fallback: assume 3 levels up (src/infrastructure/skills/ → root)
  return join(thisDir, '..', '..', '..', 'skills', 'library');
}

export interface ISkillLoader {
  /**
   * Load and format library skill content for the given skill names.
   * MCP skills (containing ':') are silently skipped.
   * Returns formatted Markdown block or empty string if no library skills resolved.
   */
  loadSkills(skillNames: string[]): Promise<string>;

  /** List all available library skill names. */
  listAvailable(): Promise<string[]>;
}

export class SkillLoader implements ISkillLoader {
  private readonly cache = new Map<string, string>();
  private readonly libraryDirPromise: Promise<string>;
  private availableCache: string[] | null = null;

  constructor(libraryDir?: string) {
    this.libraryDirPromise = libraryDir
      ? Promise.resolve(libraryDir)
      : resolveLibraryDir();
  }

  async loadSkills(skillNames: string[]): Promise<string> {
    const librarySkills = skillNames.filter((s) => !s.includes(':'));
    if (librarySkills.length === 0) return '';

    const results = await Promise.all(librarySkills.map((name) => this.loadOne(name)));
    const sections = librarySkills
      .map((name, i) => (results[i] ? `### ${name}\n\n${results[i]}` : null))
      .filter((s): s is string => s !== null);

    if (sections.length === 0) return '';
    return `## Skills\n\n${sections.join('\n\n')}`;
  }

  async listAvailable(): Promise<string[]> {
    if (this.availableCache) return this.availableCache;

    const dir = await this.libraryDirPromise;
    const entries = await listFiles(dir, '.md');
    this.availableCache = entries
      .map((e) => e.replace(/\.md$/, ''))
      .sort();
    return this.availableCache;
  }

  private async loadOne(name: string): Promise<string | null> {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached || null;

    if (!VALID_SKILL_NAME.test(name)) {
      return null;
    }

    const dir = await this.libraryDirPromise;
    const filePath = join(dir, `${name}.md`);
    try {
      const content = await readFile(filePath, 'utf8');
      this.cache.set(name, content);
      return content;
    } catch {
      process.stderr.write(`[orch] skill library: "${name}" not found in ${dir}\n`);
      this.cache.set(name, '');
      return null;
    }
  }
}
