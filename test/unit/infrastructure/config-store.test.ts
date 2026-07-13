import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { ConfigStore } from '../../../src/infrastructure/storage/config-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';

describe('ConfigStore security normalization', () => {
  it('does not treat string security booleans as enabled', async () => {
    const tmpDir = await fs.mkdtemp('/tmp/orch-config-test-');
    try {
      const paths = new Paths(tmpDir);
      await fs.mkdir(paths.root, { recursive: true });
      await fs.writeFile(paths.configPath, `execution:\n  security:\n    allow_shell_adapter: "false"\n    allow_permission_bypass: "false"\n    persist_prompts: "false"\n`);

      const config = await new ConfigStore(paths).read();

      expect(config.execution.security.allow_shell_adapter).toBe(false);
      expect(config.execution.security.allow_permission_bypass).toBe(false);
      expect(config.execution.security.persist_prompts).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves exact boolean true security values', async () => {
    const tmpDir = await fs.mkdtemp('/tmp/orch-config-test-');
    try {
      const paths = new Paths(tmpDir);
      await fs.mkdir(paths.root, { recursive: true });
      await fs.writeFile(paths.configPath, `execution:\n  security:\n    allow_shell_adapter: true\n    allow_permission_bypass: true\n    persist_prompts: true\n`);

      const config = await new ConfigStore(paths).read();

      expect(config.execution.security.allow_shell_adapter).toBe(true);
      expect(config.execution.security.allow_permission_bypass).toBe(true);
      expect(config.execution.security.persist_prompts).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
