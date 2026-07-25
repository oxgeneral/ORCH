/**
 * Global config store — reads/writes ~/.orchestry/global.yml
 *
 * Persists across projects. Creates directory if needed.
 */

import path from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import {
  DEFAULT_GLOBAL_CONFIG,
  isTuiPaletteName,
  type GlobalConfig,
} from '../../domain/global-config.js';
import { readYaml, writeYaml } from './fs-utils.js';

function globalConfigPath(): string {
  const override = process.env['ORCHESTRY_GLOBAL_CONFIG_PATH']?.trim();
  return override ? path.resolve(override) : path.join(homedir(), '.orchestry', 'global.yml');
}

export class GlobalConfigStore {
  async read(): Promise<GlobalConfig> {
    const data = await readYaml<Record<string, unknown>>(globalConfigPath());
    if (!data) return { ...DEFAULT_GLOBAL_CONFIG, tui: { ...DEFAULT_GLOBAL_CONFIG.tui, notifications: { ...DEFAULT_GLOBAL_CONFIG.tui.notifications } } };
    const tui = data.tui as Record<string, unknown> | undefined;
    const notif = tui?.notifications as Record<string, unknown> | undefined;
    return {
      tui: {
        palette: isTuiPaletteName(tui?.palette)
          ? tui.palette
          : DEFAULT_GLOBAL_CONFIG.tui.palette,
        activity_filter: tui?.activity_filter as GlobalConfig['tui']['activity_filter']
          ?? DEFAULT_GLOBAL_CONFIG.tui.activity_filter,
        notifications: {
          toast: typeof notif?.toast === 'boolean' ? notif.toast : DEFAULT_GLOBAL_CONFIG.tui.notifications.toast,
          bell: typeof notif?.bell === 'boolean' ? notif.bell : DEFAULT_GLOBAL_CONFIG.tui.notifications.bell,
        },
      },
    };
  }

  async write(config: GlobalConfig): Promise<void> {
    const configPath = globalConfigPath();
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeYaml(configPath, config as unknown as Record<string, unknown>);
  }

  async set<K extends keyof GlobalConfig['tui']>(key: K, value: GlobalConfig['tui'][K]): Promise<void> {
    const config = await this.read();
    config.tui[key] = value;
    await this.write(config);
  }
}
