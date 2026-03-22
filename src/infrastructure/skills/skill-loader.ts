/**
 * Skill Library loader.
 *
 * Resolves agent skill names to Markdown content from the bundled
 * `skills/library/` directory. Skills containing ':' are Claude Code
 * MCP skills — handled natively by Claude CLI, skipped here.
 *
 * Content is cached in-process for the lifetime of the SkillLoader instance.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Valid skill name: lowercase alphanumeric + hyphens only. */
const VALID_SKILL_NAME = /^[a-z0-9-]+$/;

/**
 * Resolve the skills/library/ directory relative to the package root.
 * Works in both dev mode (src/infrastructure/skills/) and production (dist/).
 */
function resolveLibraryDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Walk up from current file until we find skills/library/
  let dir = thisDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'skills', 'library');
    if (existsSync(candidate)) return candidate;
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
  private readonly libraryDir: string;
  private availableCache: string[] | null = null;

  constructor(libraryDir?: string) {
    if (libraryDir) {
      this.libraryDir = libraryDir;
    } else {
      this.libraryDir = resolveLibraryDir();
    }
  }

  async loadSkills(skillNames: string[]): Promise<string> {
    // Filter: only library skills (no colon = not MCP)
    const librarySkills = skillNames.filter((s) => !s.includes(':'));
    if (librarySkills.length === 0) return '';

    // Parallel reads (convention: Promise.all for file I/O)
    const results = await Promise.all(librarySkills.map((name) => this.loadOne(name)));
    const sections = librarySkills
      .map((name, i) => (results[i] ? `### ${name}\n\n${results[i]}` : null))
      .filter((s): s is string => s !== null);

    if (sections.length === 0) return '';
    return `## Skills\n\n${sections.join('\n\n')}`;
  }

  async listAvailable(): Promise<string[]> {
    if (this.availableCache) return this.availableCache;

    try {
      const entries = await readdir(this.libraryDir);
      this.availableCache = entries
        .filter((e) => e.endsWith('.md'))
        .map((e) => e.replace(/\.md$/, ''))
        .sort();
      return this.availableCache;
    } catch {
      this.availableCache = [];
      return [];
    }
  }

  private async loadOne(name: string): Promise<string | null> {
    // Cache hit
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached || null;

    // Validate name (prevent path traversal)
    if (!VALID_SKILL_NAME.test(name)) {
      return null;
    }

    const filePath = join(this.libraryDir, `${name}.md`);
    try {
      const content = await readFile(filePath, 'utf8');
      this.cache.set(name, content);
      return content;
    } catch {
      // Unknown skill — warn once, cache empty to avoid repeated reads
      console.warn(`[orch] skill library: "${name}" not found in ${this.libraryDir}`);
      this.cache.set(name, '');
      return null;
    }
  }
}
