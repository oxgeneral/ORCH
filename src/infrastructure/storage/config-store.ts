/**
 * File-based config store.
 *
 * Reads/writes .orchestry/config.yml.
 * Supports dot-notation access for get/set.
 */

import { DEFAULT_CONFIG, type OrchestratorConfig } from '../../domain/config.js';
import type { IConfigStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { readYaml, writeYaml } from './fs-utils.js';

export class ConfigStore implements IConfigStore {
  constructor(private readonly paths: Paths) {}

  async read(): Promise<OrchestratorConfig> {
    const config = await readYaml<Record<string, unknown>>(this.paths.configPath);
    return deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      config ?? {},
    ) as unknown as OrchestratorConfig;
  }

  async write(config: OrchestratorConfig): Promise<void> {
    await writeYaml(this.paths.configPath, config as unknown as Record<string, unknown>);
  }

  async get(keyPath: string): Promise<unknown> {
    const config = await this.read();
    return getByPath(config as unknown as Record<string, unknown>, keyPath);
  }

  async set(keyPath: string, value: unknown): Promise<void> {
    const config = await this.read();
    setByPath(config as unknown as Record<string, unknown>, keyPath, value);
    await this.write(config);
  }
}

function getByPath(obj: Record<string, unknown>, keyPath: string): unknown {
  const keys = keyPath.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function setByPath(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const keys = keyPath.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1]!;
  current[lastKey] = value;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}
