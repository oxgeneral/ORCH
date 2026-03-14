/**
 * Global configuration — persists across projects.
 *
 * Stored at ~/.orchestry/global.yml
 */

/** Activity feed filter preset name */
export type ActivityFilterPreset = 'all' | 'text' | 'tools' | 'errors' | 'events';

export interface NotificationPreferences {
  toast: boolean;
  bell: boolean;
}

export interface TuiPreferences {
  activity_filter: ActivityFilterPreset;
  notifications: NotificationPreferences;
}

export interface GlobalConfig {
  tui: TuiPreferences;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  tui: {
    activity_filter: 'all',
    notifications: { toast: true, bell: false },
  },
};
