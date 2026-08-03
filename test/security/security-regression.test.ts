import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('secured fork static invariants', () => {
  it('keeps package identity local and npm publication disabled', () => {
    const pkg = JSON.parse(source('package.json')) as Record<string, unknown>;
    expect(pkg.name).toBe('orch-secured-fork-local');
    expect(pkg.private).toBe(true);
    expect(pkg).not.toHaveProperty('publishConfig');
    expect(String((pkg.repository as { url: string }).url)).toContain('Thibault1818/ORCH');
    expect(String(pkg.homepage)).toContain('Thibault1818/ORCH');
    expect(String((pkg.bugs as { url: string }).url)).toContain('Thibault1818/ORCH/issues');
    expect(String((pkg.scripts as Record<string, string>).prepublishOnly)).toContain('must not be published');
    for (const path of ['readme.md', 'SECURITY.md']) {
      expect(source(path)).not.toMatch(/npm (?:install|i)(?: -g)? @oxgeneral\/orch/);
      expect(source(path)).toContain('github.com/Thibault1818/ORCH.git#ae04d3222cbc43e83ae0fffb21c526df13b540b2');
    }
  });

  it('keeps dangerous execution disabled unless both gates are enabled', () => {
    const config = source('src/domain/config.ts');
    const orchestrator = source('src/application/orchestrator.ts');
    expect(config).toMatch(/allow_permission_bypass:\s*false/);
    expect(config).toMatch(/allow_shell_adapter:\s*false/);
    expect(orchestrator).toContain("'ORCHESTRY_ALLOW_DANGEROUS_EXECUTION'");
    expect(orchestrator).toMatch(/allow_permission_bypass\s*===\s*true\s*&&\s*allowDangerousExecution/);
    expect(orchestrator).toMatch(/allow_shell_adapter\s*===\s*true\s*&&\s*allowDangerousExecution/);
    expect(source('src/infrastructure/adapters/claude.ts')).toMatch(/allowPermissionBypass\s*===\s*true/);
    expect(source('src/infrastructure/adapters/codex.ts')).toMatch(/allowPermissionBypass\s*===\s*true/);
    expect(source('src/infrastructure/adapters/shell.ts')).toMatch(/allowShellAdapter\s*!==\s*true/);
  });

  it('keeps prompts out of argv and child environments', () => {
    for (const path of [
      'src/infrastructure/adapters/claude.ts',
      'src/infrastructure/adapters/codex.ts',
      'src/infrastructure/adapters/opencode.ts',
    ]) {
      const adapter = source(path);
      expect(adapter).toMatch(/stdin\?*\.write|stdin\.write/);
      expect(adapter).not.toMatch(/args\.push\((?:fullPrompt|params\.prompt|effectiveSystemPrompt)\)/);
      expect(adapter).toContain('buildChildEnv(params.env)');
    }
    const shell = source('src/infrastructure/adapters/shell.ts');
    expect(shell).not.toMatch(/ORCH_(?:SYSTEM_)?PROMPT/);
    expect(shell).toContain('buildChildEnv(params.env)');

    const env = source('src/infrastructure/adapters/utils.ts');
    expect(env).toContain('PARENT_ENV_ALLOWLIST');
    expect(env).toContain('EXPLICIT_ENV_DENYLIST');
    expect(env).toMatch(/const env: NodeJS\.ProcessEnv = \{\}/);
    expect(env).not.toMatch(/const env[^=]*=\s*\{\s*\.\.\.process\.env/);
  });

  it('keeps redaction and prompt persistence secure by default', () => {
    const config = source('src/domain/config.ts');
    const runService = source('src/application/run-service.ts');
    const orchestrator = source('src/application/orchestrator.ts');
    const redaction = source('src/infrastructure/security/redaction.ts');
    expect(config).toMatch(/persist_prompts:\s*false/);
    expect(runService).toContain("params.persistPrompt ? params.prompt : '[redacted]'");
    expect(orchestrator).toContain('sanitizeForPersistence');
    expect(orchestrator).toContain('redactPromptLikeFields');
    expect(redaction).toContain('SECRET_PATTERNS');
    expect(redaction).toContain('SENSITIVE_KEY_RE');
  });

  it('keeps isolation, symlink, identifier, and path guards enabled', () => {
    const config = source('src/domain/config.ts');
    const paths = source('src/infrastructure/storage/paths.ts');
    const processes = source('src/infrastructure/process/process-manager.ts');
    const workspace = source('src/infrastructure/workspace/workspace-manager.ts');
    expect(config).toMatch(/workspace_mode:\s*'worktree'/);
    expect(paths).toContain('fs.lstat(expected)');
    expect(paths).toContain('stat.isSymbolicLink()');
    expect(paths).toContain('fs.realpath(expected)');
    expect(paths).toContain('ID_PATTERN.test(id)');
    expect(paths).toContain('path.relative(realProjectRoot, realRoot)');
    expect(workspace).toContain('validateWorkspacePath(workspacePath, projectRoot)');
    expect(processes).toContain('this.ownedPids.has(pid)');
    expect(processes).toMatch(/Number\.isSafeInteger\(pid\)\s*&&\s*pid\s*>\s*1/);
  });

  it('keeps postinstall opt-in and prohibits automatic npm installation', () => {
    const postinstall = source('scripts/postinstall.cjs');
    const updateCheck = source('src/cli/update-check.ts');
    const updateCommand = source('src/cli/commands/update.ts');
    expect(postinstall).toMatch(/ORCH_POSTINSTALL_OPT_IN\s*!==\s*'1'\) process\.exit\(0\)/);
    expect(postinstall).toContain('github.com/Thibault1818/ORCH');
    expect(updateCheck).not.toMatch(/execFile\(\s*['"]npm['"]\s*,\s*\[\s*['"](?:install|i)['"]/s);
    expect(updateCheck).not.toMatch(/spawn\(\s*['"]npm['"]\s*,\s*\[\s*['"](?:install|i)['"]/s);
    expect(updateCheck).not.toMatch(/Run: npm install/);
    expect(updateCheck).toMatch(/checkForUpdateSWR[\s\S]*return null/);
    expect(updateCommand).toContain(".command('update')");
    expect(updateCommand).not.toMatch(/npm (?:install|i)/);
    expect(updateCommand).not.toContain('@oxgeneral/orch');
  });

  it('keeps workflow execution and merge gates fail closed', () => {
    const orchestrator = source('src/application/orchestrator.ts');
    const engine = source('src/application/workflow/engine.ts');
    const native = source('src/infrastructure/workflow/native-adapters.ts');
    expect(orchestrator).toContain("startsWith('orchestry/workflow/')");
    expect(orchestrator).not.toMatch(/task\.status\s*=\s*(?:newStatus|'done'|'review')/);
    expect(engine).toContain("['git diff --check']");
    expect(engine).toMatch(/checks\.checks\.length\s*===\s*0/);
    expect(native).toContain("'--sandbox', 'read-only'");
    for (const flag of ['--bare', '--tools', '--disable-slash-commands', '--strict-mcp-config', '--no-session-persistence']) {
      expect(native).toContain(`'${flag}'`);
    }
  });
});
