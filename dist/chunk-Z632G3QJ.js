import { listFiles, pathExists } from './chunk-MGX3XJQL.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

var VALID_SKILL_NAME = /^[a-z0-9-]+$/;
async function resolveLibraryDir() {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills", "library");
    if (await pathExists(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(thisDir, "..", "..", "..", "skills", "library");
}
var SkillLoader = class {
  cache = /* @__PURE__ */ new Map();
  libraryDirPromise;
  availableCache = null;
  constructor(libraryDir) {
    this.libraryDirPromise = libraryDir ? Promise.resolve(libraryDir) : resolveLibraryDir();
  }
  async loadSkills(skillNames) {
    const librarySkills = skillNames.filter((s) => !s.includes(":"));
    if (librarySkills.length === 0) return "";
    const results = await Promise.all(librarySkills.map((name) => this.loadOne(name)));
    const sections = librarySkills.map((name, i) => results[i] ? `### ${name}

${results[i]}` : null).filter((s) => s !== null);
    if (sections.length === 0) return "";
    return `## Skills

${sections.join("\n\n")}`;
  }
  async listAvailable() {
    if (this.availableCache) return this.availableCache;
    const dir = await this.libraryDirPromise;
    const entries = await listFiles(dir, ".md");
    this.availableCache = entries.map((e) => e.replace(/\.md$/, "")).sort();
    return this.availableCache;
  }
  async loadOne(name) {
    const cached = this.cache.get(name);
    if (cached !== void 0) return cached || null;
    if (!VALID_SKILL_NAME.test(name)) {
      return null;
    }
    const dir = await this.libraryDirPromise;
    const filePath = join(dir, `${name}.md`);
    try {
      const content = await readFile(filePath, "utf8");
      this.cache.set(name, content);
      return content;
    } catch {
      process.stderr.write(`[orch] skill library: "${name}" not found in ${dir}
`);
      this.cache.set(name, "");
      return null;
    }
  }
};

export { SkillLoader };
//# sourceMappingURL=chunk-Z632G3QJ.js.map
//# sourceMappingURL=chunk-Z632G3QJ.js.map