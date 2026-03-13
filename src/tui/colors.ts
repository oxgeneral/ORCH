/**
 * TUI color palette — "Command & Control" theme.
 *
 * Dark-first design with amber brand accent and strategic color pops.
 * Hex equivalents of ANSI 256 palette for Ink compatibility.
 */

import type { TaskStatus } from '../domain/task.js';

export const tuiColors = {
  // Brand
  amber: '#ffaf00',      // ansi256(214) — logo, selected cursor, accents
  amberDim: '#af8700',   // ansi256(136) — amber at reduced intensity

  // Semantic
  green: '#5faf87',      // ansi256(72) — running, success, active
  red: '#d75f5f',        // ansi256(167) — failed, P1, errors
  blue: '#5fafd7',       // ansi256(74) — review, info
  yellow: '#d7af00',     // ansi256(178) — retrying, P2, warning
  cyan: '#5fd7d7',       // ansi256(80) — timestamps, metadata
  purple: '#af87ff',     // ansi256(141) — file paths, labels

  // Neutrals (high → low intensity)
  white: '#eeeeee',      // ansi256(255) — primary text
  silver: '#bcbcbc',     // ansi256(250) — secondary text
  gray: '#808080',       // ansi256(244) — tertiary text
  dim: '#585858',        // ansi256(240) — subtle text, deemphasized
  ghost: '#3a3a3a',      // ansi256(237) — rules, separators
  void: '#262626',       // ansi256(235) — deepest background elements

  // Semantic backgrounds (for log highlights)
  errorBg: '#3d1515',    // deep red background for errors
  warnBg: '#3d2e0a',     // deep amber background for warnings
  successBg: '#0f2d1f',  // deep green background for success
  infoBg: '#1a1a22',     // subtle dark background for info chips
  toolBg: '#0f1f2d',     // deep blue background for tool calls
} as const;

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

/** Canonical task status → foreground color mapping. */
export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  in_progress: tuiColors.green,
  retrying: tuiColors.yellow,
  review: tuiColors.blue,
  todo: tuiColors.dim,
  done: tuiColors.green,
  failed: tuiColors.red,
  cancelled: tuiColors.dim,
};
