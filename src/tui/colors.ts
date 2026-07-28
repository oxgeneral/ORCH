/**
 * TUI color palette — "Command & Control" theme.
 *
 * Dark-first design with amber brand accent and strategic color pops.
 * The explicit light palette uses dark foregrounds and pale chip backgrounds
 * for terminals whose default background is light.
 * Hex equivalents of ANSI 256 palette for Ink compatibility.
 */

import type { TaskStatus } from '../domain/task.js';
import type { GoalStatus } from '../domain/goal.js';
import type { TuiPaletteName } from '../domain/global-config.js';

export interface TuiColorPalette {
  amber: string;
  amberDim: string;
  green: string;
  red: string;
  blue: string;
  yellow: string;
  cyan: string;
  purple: string;
  white: string;
  silver: string;
  gray: string;
  dim: string;
  ghost: string;
  void: string;
  errorBg: string;
  warnBg: string;
  successBg: string;
  infoBg: string;
  toolBg: string;
  accentBg: string;
  neutralBg: string;
  alternatingRowBg: string;
  darkText: string;
  pink: string;
  olive: string;
  orange: string;
}

export const TUI_PALETTES: Readonly<Record<TuiPaletteName, Readonly<TuiColorPalette>>> = {
  amber: {
    amber: '#ffaf00',
    amberDim: '#af8700',
    green: '#5faf87',
    red: '#d75f5f',
    blue: '#5fafd7',
    yellow: '#d7af00',
    cyan: '#5fd7d7',
    purple: '#af87ff',
    white: '#eeeeee',
    silver: '#bcbcbc',
    gray: '#808080',
    dim: '#585858',
    ghost: '#3a3a3a',
    void: '#262626',
    errorBg: '#3d1515',
    warnBg: '#3d2e0a',
    successBg: '#0f2d1f',
    infoBg: '#1a1a22',
    toolBg: '#0f1f2d',
    accentBg: '#2d1f0a',
    neutralBg: '#1a1a22',
    alternatingRowBg: '#1a1a1a',
    darkText: '#0a0a0c',
    pink: '#d787af',
    olive: '#afaf5f',
    orange: '#d7875f',
  },
  ocean: {
    amber: '#5fafff',
    amberDim: '#5f87af',
    green: '#5fd7af',
    red: '#ff6b6b',
    blue: '#87afff',
    yellow: '#ffd75f',
    cyan: '#5fd7ff',
    purple: '#af87ff',
    white: '#f0f6ff',
    silver: '#b8c7d9',
    gray: '#7890a8',
    dim: '#52677a',
    ghost: '#304252',
    void: '#17212b',
    errorBg: '#3a171d',
    warnBg: '#352e12',
    successBg: '#102d29',
    infoBg: '#14283a',
    toolBg: '#102f46',
    accentBg: '#12304a',
    neutralBg: '#182631',
    alternatingRowBg: '#141d2b',
    darkText: '#07131d',
    pink: '#ff87d7',
    olive: '#afd787',
    orange: '#ff9f5f',
  },
  forest: {
    amber: '#5fd787',
    amberDim: '#5f9f6f',
    green: '#87d75f',
    red: '#e06c75',
    blue: '#5fafd7',
    yellow: '#d7d75f',
    cyan: '#87d7af',
    purple: '#af87d7',
    white: '#edf5ed',
    silver: '#b8c9b8',
    gray: '#7f967f',
    dim: '#536b57',
    ghost: '#34483a',
    void: '#1b271e',
    errorBg: '#3a191c',
    warnBg: '#303013',
    successBg: '#12351d',
    infoBg: '#1a2b20',
    toolBg: '#15302a',
    accentBg: '#14351f',
    neutralBg: '#1c2920',
    alternatingRowBg: '#172219',
    darkText: '#09150c',
    pink: '#d787af',
    olive: '#afd75f',
    orange: '#d79f5f',
  },
  violet: {
    amber: '#af87ff',
    amberDim: '#7f5faf',
    green: '#5fd7a7',
    red: '#ff6b87',
    blue: '#8787ff',
    yellow: '#ffd75f',
    cyan: '#5fd7d7',
    purple: '#d787ff',
    white: '#f4efff',
    silver: '#c7bbd9',
    gray: '#9380a8',
    dim: '#655477',
    ghost: '#433552',
    void: '#251b2d',
    errorBg: '#401724',
    warnBg: '#382c12',
    successBg: '#123026',
    infoBg: '#271d36',
    toolBg: '#1c2342',
    accentBg: '#30204a',
    neutralBg: '#261e30',
    alternatingRowBg: '#1d1826',
    darkText: '#130a1d',
    pink: '#ff87d7',
    olive: '#afd787',
    orange: '#ff9f7f',
  },
  light: {
    amber: '#9a6700',
    amberDim: '#7a5200',
    green: '#1a7f37',
    red: '#b42318',
    blue: '#175cd3',
    yellow: '#946200',
    cyan: '#007a85',
    purple: '#6941c6',
    white: '#1d2939',
    silver: '#344054',
    gray: '#667085',
    dim: '#475467',
    ghost: '#667085',
    void: '#f2f4f7',
    errorBg: '#fef3f2',
    warnBg: '#fffaeb',
    successBg: '#ecfdf3',
    infoBg: '#eff8ff',
    toolBg: '#eef4ff',
    accentBg: '#fff7e0',
    neutralBg: '#f2f4f7',
    alternatingRowBg: '#f8fafc',
    darkText: '#1d2939',
    pink: '#c11574',
    olive: '#5f6f13',
    orange: '#b54708',
  },
};

/** Mutable live palette. Imports keep the same object reference across TUI rerenders. */
export const tuiColors: TuiColorPalette = { ...TUI_PALETTES.amber };

export function applyTuiPalette(name: TuiPaletteName): void {
  Object.assign(tuiColors, TUI_PALETTES[name]);
}

/** Preserve a semantic color token while switching between palette values. */
export function remapTuiColor(
  color: string,
  from: TuiPaletteName,
  to: TuiPaletteName,
): string {
  const fromPalette = TUI_PALETTES[from];
  const token = (Object.keys(fromPalette) as Array<keyof TuiColorPalette>)
    .find((key) => fromPalette[key] === color);
  return token ? TUI_PALETTES[to][token] : color;
}

export function getAgentColors(): readonly string[] {
  return [
    tuiColors.green,
    tuiColors.blue,
    tuiColors.purple,
    tuiColors.yellow,
    tuiColors.cyan,
    tuiColors.pink,
    tuiColors.olive,
    tuiColors.orange,
  ];
}

/** Heavy horizontal rule character (━) */
export const HEAVY_RULE = '\u2501';
/** Light horizontal rule character (─) */
export const LIGHT_RULE = '\u2500';
/** Dot separator (·) */
export const DOT = '\u00B7';
/** Lozenge (◈) — review status, team headers */
export const LOZENGE = '\u25C8';
/** Star (★) — team leads */
export const STAR = '\u2605';
/** Loop arrow (⟳) — autonomous mode */
export const LOOP = '\u27F3';
/** Filled diamond (◆) — brand marker, onboarding */
export const DIAMOND = '\u25C6';

const TASK_STATUS_COLOR_TOKEN: Record<TaskStatus, keyof TuiColorPalette> = {
  in_progress: 'green',
  retrying: 'yellow',
  review: 'blue',
  todo: 'dim',
  done: 'green',
  failed: 'red',
  cancelled: 'dim',
};

/** Resolve a task status color from the active palette. */
export function getTaskStatusColor(status: TaskStatus): string {
  return tuiColors[TASK_STATUS_COLOR_TOKEN[status]];
}

/**
 * Pre-computed rule strings to avoid per-render Intl.Segmenter overhead.
 * Unicode box-drawing chars force the slow Segmenter path in string-width;
 * caching the repeated strings means each unique length is allocated once.
 */
const _heavyCache = new Map<number, string>();
const _lightCache = new Map<number, string>();
export function heavyRule(len: number): string {
  if (len <= 0) return '';
  let s = _heavyCache.get(len);
  if (!s) { s = HEAVY_RULE.repeat(len); _heavyCache.set(len, s); }
  return s;
}
export function lightRule(len: number): string {
  if (len <= 0) return '';
  let s = _lightCache.get(len);
  if (!s) { s = LIGHT_RULE.repeat(len); _lightCache.set(len, s); }
  return s;
}

/** Cap a string to maxLen chars, appending '…' if truncated. */
export function capLine(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
}

/** Max chars for goal descriptions/progress reports rendered in TUI panels. */
export const MAX_PANEL_TEXT = 10_000;

/** Cap an optional multi-line text block, appending a truncation notice. Returns undefined for empty/missing strings. */
export function capText(s: string | undefined, max: number = MAX_PANEL_TEXT): string | undefined {
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) + '\n\u2026[truncated]' : s;
}

const GOAL_STATUS_COLOR_TOKEN: Record<GoalStatus, keyof TuiColorPalette> = {
  active: 'green',
  paused: 'dim',
  achieved: 'amber',
  abandoned: 'ghost',
};

/** Resolve a goal status color from the active palette. */
export function getGoalStatusColor(status: GoalStatus): string {
  return tuiColors[GOAL_STATUS_COLOR_TOKEN[status]];
}
