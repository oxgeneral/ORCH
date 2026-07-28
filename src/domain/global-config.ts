/**
 * Global configuration — persists across projects.
 *
 * Stored at ~/.orchestry/global.yml
 */

/** Activity feed filter preset name */
export type ActivityFilterPreset = 'all' | 'text' | 'tools' | 'errors' | 'events';

/** Built-in TUI color palette name. */
export type TuiPaletteName = 'amber' | 'ocean' | 'forest' | 'violet' | 'light';

export const TUI_PALETTE_NAMES: readonly TuiPaletteName[] = [
  'amber',
  'ocean',
  'forest',
  'violet',
  'light',
];

export function isTuiPaletteName(value: unknown): value is TuiPaletteName {
  return typeof value === 'string' && TUI_PALETTE_NAMES.includes(value as TuiPaletteName);
}

export interface NotificationPreferences {
  toast: boolean;
  bell: boolean;
}

export interface TuiPreferences {
  palette: TuiPaletteName;
  activity_filter: ActivityFilterPreset;
  notifications: NotificationPreferences;
}

export interface GlobalConfig {
  tui: TuiPreferences;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  tui: {
    palette: 'amber',
    activity_filter: 'all',
    notifications: { toast: true, bell: false },
  },
};
