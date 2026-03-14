/**
 * HelpOverlay — full-screen modal showing keyboard shortcuts.
 *
 * Three columns: Navigation | Actions | Commands.
 * Dismisses on ?, F1, Esc, or any other key (which also executes its action).
 */

import React from 'react';
import { Box, Text } from 'ink';
import { tuiColors, lightRule } from '../colors.js';

/* ── Box-drawing ────────────────────────────────── */

const TL = '\u256D'; // ╭
const TR = '\u256E'; // ╮
const BL = '\u2570'; // ╰
const BR = '\u256F'; // ╯
const V  = '\u2502'; // │

/* ── Shortcut data ──────────────────────────────── */

interface ShortcutEntry {
  key: string;
  label: string;
}

const NAVIGATION: ShortcutEntry[] = [
  { key: '\u2191\u2193/j/k', label: 'Navigate' },
  { key: 'Tab/\u2190\u2192', label: 'Switch tabs' },
  { key: 'Enter',            label: 'Detail view' },
  { key: 'G',                label: 'Goals tab' },
  { key: 'T',                label: 'Tasks tab' },
  { key: 'A',                label: 'Agents tab' },
  { key: 'L',                label: 'Logs tab' },
];

const ACTIONS: ShortcutEntry[] = [
  { key: 'N',  label: 'New item' },
  { key: 'E',  label: 'Edit' },
  { key: 'D',  label: 'Delete' },
  { key: 'R',  label: 'Run task' },
  { key: 'S',  label: 'Show / Stop' },
  { key: 'C',  label: 'Cancel' },
  { key: 'A',  label: 'Approve' },
  { key: 'X',  label: 'Reject' },
  { key: 'U',  label: 'Autonomous' },
  { key: 'Z',  label: 'Undo delete' },
];

const COMMANDS: ShortcutEntry[] = [
  { key: '/',         label: 'Command mode' },
  { key: '/task add', label: 'Create task' },
  { key: '/run',      label: 'Execute' },
  { key: '/watch',    label: 'Auto-dispatch' },
  { key: '/config',   label: 'Settings' },
  { key: '/help',     label: 'Help' },
  { key: '/quit',     label: 'Exit' },
];

/* ── Layout constants ───────────────────────────── */

const KEY_PAD = 10;
const COL_W = 22;

function fmtDivider(title: string): string {
  const pad = Math.max(0, Math.floor((COL_W - title.length - 2) / 2));
  const right = Math.max(0, COL_W - pad - title.length - 2);
  return lightRule(pad) + ' ' + title + ' ' + lightRule(right);
}

/* ── HelpOverlay ────────────────────────────────── */

export interface HelpOverlayProps {
  width: number;
  height: number;
}

export const HelpOverlay = React.memo(function HelpOverlay({ width, height }: HelpOverlayProps) {
  // Box: ╭ + content + ╮. Content = 3 cols × COL_W + 2 separators (3 each) + 2 margins
  const innerW = COL_W * 3 + 3 + 3 + 2; // 80
  const boxW = innerW + 2; // +2 for left/right border chars = 82
  const hLine = lightRule(boxW - 2);

  const titleText = 'KEYBOARD SHORTCUTS';
  const titlePad = Math.max(0, Math.floor((innerW - titleText.length) / 2));
  const titleRight = Math.max(0, innerW - titlePad - titleText.length);

  const footerText = 'Press any key to dismiss';
  const footerPad = Math.max(0, Math.floor((innerW - footerText.length) / 2));
  const footerRight = Math.max(0, innerW - footerPad - footerText.length);

  const maxRows = Math.max(NAVIGATION.length, ACTIONS.length, COMMANDS.length);
  const totalH = maxRows + 10;
  const topMargin = Math.max(0, Math.floor((height - totalH) / 2));

  // Build row data
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < maxRows; i++) {
    const nav = i < NAVIGATION.length ? NAVIGATION[i]! : null;
    const act = i < ACTIONS.length ? ACTIONS[i]! : null;
    const cmd = i < COMMANDS.length ? COMMANDS[i]! : null;

    rows.push(
      <Text key={`r${i}`}>
        <Text color={tuiColors.amber}>{V}</Text>
        <Text> </Text>
        {nav ? (
          <>
            <Text color={tuiColors.amber} bold>{nav.key.padEnd(KEY_PAD)}</Text>
            <Text color={tuiColors.silver}>{nav.label.padEnd(COL_W - KEY_PAD)}</Text>
          </>
        ) : (
          <Text>{' '.repeat(COL_W)}</Text>
        )}
        <Text color={tuiColors.dim}> {V} </Text>
        {act ? (
          <>
            <Text color={tuiColors.amber} bold>{act.key.padEnd(KEY_PAD)}</Text>
            <Text color={tuiColors.silver}>{act.label.padEnd(COL_W - KEY_PAD)}</Text>
          </>
        ) : (
          <Text>{' '.repeat(COL_W)}</Text>
        )}
        <Text color={tuiColors.dim}> {V} </Text>
        {cmd ? (
          <>
            <Text color={tuiColors.amber} bold>{cmd.key.padEnd(KEY_PAD)}</Text>
            <Text color={tuiColors.silver}>{cmd.label.padEnd(COL_W - KEY_PAD)}</Text>
          </>
        ) : (
          <Text>{' '.repeat(COL_W)}</Text>
        )}
        <Text> </Text>
        <Text color={tuiColors.amber}>{V}</Text>
      </Text>,
    );
  }

  const emptyRow = (k: string) => (
    <Text key={k}>
      <Text color={tuiColors.amber}>{V}</Text>
      <Text>{' '.repeat(innerW)}</Text>
      <Text color={tuiColors.amber}>{V}</Text>
    </Text>
  );

  const navDiv = fmtDivider('NAVIGATION');
  const actDiv = fmtDivider('ACTIONS');
  const cmdDiv = fmtDivider('COMMANDS');

  return (
    <Box flexDirection="column" paddingX={Math.max(0, Math.floor((width - boxW) / 2))} marginTop={topMargin}>
      {/* Top border */}
      <Text color={tuiColors.amber}>{TL}{hLine}{TR}</Text>

      {emptyRow('e1')}

      {/* Title */}
      <Text>
        <Text color={tuiColors.amber}>{V}</Text>
        <Text>{' '.repeat(titlePad)}</Text>
        <Text color={tuiColors.amber} bold>{titleText}</Text>
        <Text>{' '.repeat(titleRight)}</Text>
        <Text color={tuiColors.amber}>{V}</Text>
      </Text>

      {emptyRow('e2')}

      {/* Section dividers */}
      <Text>
        <Text color={tuiColors.amber}>{V}</Text>
        <Text> </Text>
        <Text color={tuiColors.dim}>{navDiv}</Text>
        <Text color={tuiColors.dim}> {V} </Text>
        <Text color={tuiColors.dim}>{actDiv}</Text>
        <Text color={tuiColors.dim}> {V} </Text>
        <Text color={tuiColors.dim}>{cmdDiv}</Text>
        <Text> </Text>
        <Text color={tuiColors.amber}>{V}</Text>
      </Text>

      {emptyRow('e3')}

      {/* Shortcut rows */}
      {rows}

      {emptyRow('e4')}

      {/* Footer */}
      <Text>
        <Text color={tuiColors.amber}>{V}</Text>
        <Text>{' '.repeat(footerPad)}</Text>
        <Text color={tuiColors.dim}>{footerText}</Text>
        <Text>{' '.repeat(footerRight)}</Text>
        <Text color={tuiColors.amber}>{V}</Text>
      </Text>

      {emptyRow('e5')}

      {/* Bottom border */}
      <Text color={tuiColors.amber}>{BL}{hLine}{BR}</Text>
    </Box>
  );
});
