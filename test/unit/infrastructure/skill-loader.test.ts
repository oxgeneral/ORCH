import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLoader } from '../../../src/infrastructure/skills/skill-loader.js';

function makeTmpLib(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'orch-skills-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe('SkillLoader', () => {
  let tmpDir: string | undefined;
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    warnSpy.mockClear();
  });

  describe('loadSkills', () => {
    it('loads library skills and formats as Markdown block', async () => {
      tmpDir = makeTmpLib({
        'review.md': '# Review\nDo a review.',
        'investigate.md': '# Investigate\nDebug stuff.',
      });
      const loader = new SkillLoader(tmpDir);
      const result = await loader.loadSkills(['review', 'investigate']);

      expect(result).toContain('## Skills');
      expect(result).toContain('### review');
      expect(result).toContain('# Review\nDo a review.');
      expect(result).toContain('### investigate');
      expect(result).toContain('# Investigate\nDebug stuff.');
    });

    it('skips MCP skills (containing colon)', async () => {
      tmpDir = makeTmpLib({ 'review.md': 'Review content' });
      const loader = new SkillLoader(tmpDir);
      const result = await loader.loadSkills(['feature-dev:code-explorer', 'review']);

      expect(result).toContain('### review');
      expect(result).not.toContain('feature-dev');
    });

    it('returns empty string when all skills are MCP', async () => {
      tmpDir = makeTmpLib({});
      const loader = new SkillLoader(tmpDir);
      const result = await loader.loadSkills(['feature-dev:code-explorer', 'testing-suite:generate-tests']);

      expect(result).toBe('');
    });

    it('returns empty string for empty skills array', async () => {
      tmpDir = makeTmpLib({});
      const loader = new SkillLoader(tmpDir);
      const result = await loader.loadSkills([]);

      expect(result).toBe('');
    });

    it('silently skips unknown library skills with warning', async () => {
      tmpDir = makeTmpLib({ 'review.md': 'Review content' });
      const loader = new SkillLoader(tmpDir);
      const result = await loader.loadSkills(['review', 'nonexistent']);

      expect(result).toContain('### review');
      expect(result).not.toContain('nonexistent');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"nonexistent"'));
    });

    it('rejects path traversal attempts', async () => {
      tmpDir = makeTmpLib({ 'review.md': 'Review content' });
      const loader = new SkillLoader(tmpDir);
      const result = await loader.loadSkills(['../etc/passwd', '../../secret', 'review']);

      expect(result).toContain('### review');
      expect(result).not.toContain('passwd');
      expect(result).not.toContain('secret');
    });

    it('rejects names with uppercase or special characters', async () => {
      tmpDir = makeTmpLib({});
      const loader = new SkillLoader(tmpDir);
      const result = await loader.loadSkills(['Review', 'my_skill', 'some.skill']);

      expect(result).toBe('');
    });

    it('caches loaded skills', async () => {
      tmpDir = makeTmpLib({ 'review.md': 'Review content' });
      const loader = new SkillLoader(tmpDir);

      await loader.loadSkills(['review']);
      // Overwrite file — should still get cached content
      writeFileSync(join(tmpDir, 'review.md'), 'CHANGED');
      const result = await loader.loadSkills(['review']);

      expect(result).toContain('Review content');
      expect(result).not.toContain('CHANGED');
    });

    it('caches unknown skill as empty (no repeated warnings)', async () => {
      tmpDir = makeTmpLib({});
      const loader = new SkillLoader(tmpDir);

      await loader.loadSkills(['missing']);
      await loader.loadSkills(['missing']);

      // Only one warning for the first miss
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('listAvailable', () => {
    it('lists .md files without extension', async () => {
      tmpDir = makeTmpLib({
        'review.md': 'x',
        'qa.md': 'x',
        'careful.md': 'x',
        'not-a-skill.txt': 'x',
      });
      const loader = new SkillLoader(tmpDir);
      const list = await loader.listAvailable();

      expect(list).toEqual(['careful', 'qa', 'review']);
    });

    it('returns empty for missing directory', async () => {
      const loader = new SkillLoader('/nonexistent/path');
      const list = await loader.listAvailable();

      expect(list).toEqual([]);
    });

    it('caches the list', async () => {
      tmpDir = makeTmpLib({ 'review.md': 'x' });
      const loader = new SkillLoader(tmpDir);

      const list1 = await loader.listAvailable();
      // Add file — should still get cached list
      writeFileSync(join(tmpDir, 'new-skill.md'), 'x');
      const list2 = await loader.listAvailable();

      expect(list1).toEqual(list2);
      expect(list2).toEqual(['review']);
    });
  });

  describe('integration with real library', () => {
    it('resolves bundled library from default path', async () => {
      const loader = new SkillLoader();
      const list = await loader.listAvailable();

      // Should find at least the skills we created
      expect(list.length).toBeGreaterThanOrEqual(20);
      expect(list).toContain('review');
      expect(list).toContain('qa');
      expect(list).toContain('careful');
      expect(list).toContain('investigate');
      expect(list).toContain('ship');
    });

    it('loads real skill content', async () => {
      const loader = new SkillLoader();
      const result = await loader.loadSkills(['careful']);

      expect(result).toContain('## Skills');
      expect(result).toContain('### careful');
      expect(result.length).toBeGreaterThan(100);
    });
  });
});
