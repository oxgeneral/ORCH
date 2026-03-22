import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { AGENT_SHOP_TEMPLATES } from '../../../src/domain/agent-shop.js';
import { SkillLoader } from '../../../src/infrastructure/skills/skill-loader.js';

const loader = new SkillLoader();

// ---------------------------------------------------------------------------
// Template skill reference integrity
// ---------------------------------------------------------------------------

describe('Agent shop template skill references', () => {
  let availableSkills: string[];

  beforeAll(async () => {
    availableSkills = await loader.listAvailable();
  });

  it('library skill list is non-empty', () => {
    expect(availableSkills.length).toBeGreaterThan(0);
  });

  it('every non-MCP skill referenced by a template exists in the library', () => {
    const missing: { template: string; skill: string }[] = [];

    for (const template of AGENT_SHOP_TEMPLATES) {
      const nonMcpSkills = template.skills.filter((s) => !s.includes(':'));
      for (const skill of nonMcpSkills) {
        if (!availableSkills.includes(skill)) {
          missing.push({ template: template.key, skill });
        }
      }
    }

    expect(
      missing,
      `Missing library skills:\n${missing.map((m) => `  template="${m.template}" skill="${m.skill}"`).join('\n')}`,
    ).toHaveLength(0);
  });

  it('no template has more than 4 skills (ANTI-PATTERNS limit)', () => {
    const violations = AGENT_SHOP_TEMPLATES.filter((t) => t.skills.length > 4);

    expect(
      violations,
      `Templates exceeding 4-skill limit:\n${violations.map((t) => `  key="${t.key}" skills=${t.skills.length}`).join('\n')}`,
    ).toHaveLength(0);
  });

  it('every template has at least 1 skill', () => {
    const violations = AGENT_SHOP_TEMPLATES.filter((t) => t.skills.length === 0);

    expect(
      violations,
      `Templates with no skills:\n${violations.map((t) => `  key="${t.key}"`).join('\n')}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Library skill file integrity
// ---------------------------------------------------------------------------

describe('Library skill file integrity', () => {
  let availableSkills: string[];

  const FORBIDDEN_STRINGS = ['gstack-telemetry', 'gstack-update-check', 'LAKE_INTRO'];

  const MAX_SKILL_SIZE = 100 * 1024; // 100 KB

  beforeAll(async () => {
    availableSkills = await loader.listAvailable();
  });

  it('library exposes at least one skill', () => {
    expect(availableSkills.length).toBeGreaterThan(0);
  });

  it('each skill loads non-empty content', async () => {
    for (const skillName of availableSkills) {
      const result = await loader.loadSkills([skillName]);
      expect(result, `Skill "${skillName}" loaded empty content`).not.toBe('');
      expect(result.length, `Skill "${skillName}" content is unexpectedly short`).toBeGreaterThan(10);
    }
  });

  it('each skill file is smaller than 100 KB', async () => {
    // Resolve the library directory the same way SkillLoader does — walk up from
    // this test file until we find skills/library/.
    const thisDir = dirname(fileURLToPath(import.meta.url));
    let dir = thisDir;
    let libraryDir: string | null = null;

    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'skills', 'library');
      try {
        await readFile(join(candidate, '.gitkeep')).catch(() => undefined);
        // list to confirm it exists
        const { access } = await import('node:fs/promises');
        await access(candidate);
        libraryDir = candidate;
        break;
      } catch {
        dir = dirname(dir);
      }
    }

    expect(libraryDir, 'Could not locate skills/library/ directory').not.toBeNull();

    for (const skillName of availableSkills) {
      const filePath = join(libraryDir!, `${skillName}.md`);
      const content = await readFile(filePath, 'utf8');
      expect(
        content.length,
        `Skill "${skillName}" exceeds 100 KB (${content.length} bytes)`,
      ).toBeLessThan(MAX_SKILL_SIZE);
    }
  });

  it('no skill file contains gstack-specific remnants', async () => {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    let dir = thisDir;
    let libraryDir: string | null = null;

    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'skills', 'library');
      try {
        const { access } = await import('node:fs/promises');
        await access(candidate);
        libraryDir = candidate;
        break;
      } catch {
        dir = dirname(dir);
      }
    }

    expect(libraryDir, 'Could not locate skills/library/ directory').not.toBeNull();

    const violations: { skill: string; fragment: string }[] = [];

    for (const skillName of availableSkills) {
      const filePath = join(libraryDir!, `${skillName}.md`);
      const content = await readFile(filePath, 'utf8');
      for (const fragment of FORBIDDEN_STRINGS) {
        if (content.includes(fragment)) {
          violations.push({ skill: skillName, fragment });
        }
      }
    }

    expect(
      violations,
      `Skills containing gstack remnants:\n${violations.map((v) => `  skill="${v.skill}" fragment="${v.fragment}"`).join('\n')}`,
    ).toHaveLength(0);
  });
});
