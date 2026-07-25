import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsUtils = vi.hoisted(() => ({
  readYaml: vi.fn(),
  writeYaml: vi.fn(),
}));

vi.mock('../../../src/infrastructure/storage/fs-utils.js', () => fsUtils);

import { GlobalConfigStore } from '../../../src/infrastructure/storage/global-config-store.js';

describe('GlobalConfigStore palette migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['ORCHESTRY_GLOBAL_CONFIG_PATH'];
  });

  afterEach(() => {
    delete process.env['ORCHESTRY_GLOBAL_CONFIG_PATH'];
  });

  it('reads a persisted global palette', async () => {
    fsUtils.readYaml.mockResolvedValue({
      tui: {
        palette: 'ocean',
        activity_filter: 'tools',
        notifications: { toast: false, bell: true },
      },
    });

    const config = await new GlobalConfigStore().read();

    expect(config.tui.palette).toBe('ocean');
  });

  it('falls back to amber for missing or unknown legacy values', async () => {
    fsUtils.readYaml.mockResolvedValue({
      tui: {
        palette: 'solarized',
        activity_filter: 'all',
      },
    });

    const config = await new GlobalConfigStore().read();

    expect(config.tui.palette).toBe('amber');
  });

  it('uses an isolated config path when explicitly overridden', async () => {
    process.env['ORCHESTRY_GLOBAL_CONFIG_PATH'] = '/tmp/orch-e2e/global.yml';
    fsUtils.readYaml.mockResolvedValue(null);

    await new GlobalConfigStore().read();

    expect(fsUtils.readYaml).toHaveBeenCalledWith('/tmp/orch-e2e/global.yml');
  });
});
