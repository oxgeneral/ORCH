import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsUtils = vi.hoisted(() => ({
  readYaml: vi.fn(),
  writeYaml: vi.fn(),
}));

vi.mock('../../../src/infrastructure/storage/fs-utils.js', () => fsUtils);

import { GlobalConfigStore } from '../../../src/infrastructure/storage/global-config-store.js';

describe('GlobalConfigStore palette migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
