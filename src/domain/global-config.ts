/**
 * Global configuration — persists across projects.
 *
 * Stored at ~/.orchestry/global.yml
 */

/** Activity feed filter preset name */
export type ActivityFilterPreset = 'all' | 'text' | 'tools' | 'errors' | 'events';

export interface TuiPreferences {
  activity_filter: ActivityFilterPreset;
}

export interface GlobalConfig {
  tui: TuiPreferences;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  tui: {
    activity_filter: 'all',
  },
};
