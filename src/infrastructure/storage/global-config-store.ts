/**
 * Global config store — reads/writes ~/.orchestry/global.yml
 *
 * Persists across projects. Creates directory if needed.
 */

import path from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { DEFAULT_GLOBAL_CONFIG, type GlobalConfig } from '../../domain/global-config.js';
import { readYaml, writeYaml } from './fs-utils.js';

const GLOBAL_DIR = path.join(homedir(), '.orchestry');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_DIR, 'global.yml');

export class GlobalConfigStore {
  async read(): Promise<GlobalConfig> {
    const data = await readYaml<Record<string, unknown>>(GLOBAL_CONFIG_PATH);
    if (!data) return { ...DEFAULT_GLOBAL_CONFIG };
    return {
      tui: {
        activity_filter: (data.tui as Record<string, unknown>)?.activity_filter as GlobalConfig['tui']['activity_filter']
          ?? DEFAULT_GLOBAL_CONFIG.tui.activity_filter,
      },
    };
  }

  async write(config: GlobalConfig): Promise<void> {
    await mkdir(GLOBAL_DIR, { recursive: true });
    await writeYaml(GLOBAL_CONFIG_PATH, config as unknown as Record<string, unknown>);
  }

  async set<K extends keyof GlobalConfig['tui']>(key: K, value: GlobalConfig['tui'][K]): Promise<void> {
    const config = await this.read();
    config.tui[key] = value;
    await this.write(config);
  }
}
