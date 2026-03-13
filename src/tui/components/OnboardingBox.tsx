/**
 * TUI OnboardingBox — empty-state guidance for new projects.
 *
 * Shows a bordered box with title, description, and hotkey hints
 * when a tab has 0 items (full variant) or 1-2 items (compact nudge).
 * Disappears at 3+ items.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { tuiColors, LIGHT_RULE, DIAMOND } from '../colors.js';

/* ── Box-drawing characters ─────────────────────── */

const TL = '\u256D'; // ╭
const TR = '\u256E'; // ╮
const BL = '\u2570'; // ╰
const BR = '\u256F'; // ╯
const V  = '\u2502'; // │

/* ── Types ───────────────────────────────────────── */

export interface OnboardingHint {
  key: string;
  label: string;
}

export interface OnboardingConfig {
  title: string;
  description: string[];
  hints: OnboardingHint[];
  nudge: string;
}

export interface OnboardingBoxProps {
  count: number;
  config: OnboardingConfig;
  width?: number;
}

/* ── Helpers ─────────────────────────────────────── */

/** Bordered row: │  content  │ */
function Row({ children, cw }: { children: string; cw: number }) {
  return (
    <Text>
      <Text color={tuiColors.ghost}>{V}</Text>
      <Text>  {children.padEnd(cw)}  </Text>
      <Text color={tuiColors.ghost}>{V}</Text>
    </Text>
  );
}

/** Empty bordered row */
function EmptyRow({ cw }: { cw: number }) {
  return <Row cw={cw}>{''}</Row>;
}

/* ── Component ───────────────────────────────────── */

export function OnboardingBox({ count, config, width }: OnboardingBoxProps) {
  if (count >= 3) return null;

  // Box total width: TL + H*n + TR = boxW. Content between │  ...  │ = boxW - 6
  const boxW = Math.min((width ?? 44) - 4, 50); // -4 for paddingX on outer Box
  const cw = boxW - 6; // content width between "│  " and "  │"

  const hLine = LIGHT_RULE.repeat(boxW - 2);
  const topBorder = <Text color={tuiColors.ghost}>{TL}{hLine}{TR}</Text>;
  const botBorder = <Text color={tuiColors.ghost}>{BL}{hLine}{BR}</Text>;

  if (count > 0) {
    // Compact nudge variant
    const hint = config.hints[0];
    const hintSuffix = hint ? `  ${hint.key} ${hint.label}` : '';

    return (
      <Box flexDirection="column" paddingX={2} marginTop={1}>
        {topBorder}
        <Text>
          <Text color={tuiColors.ghost}>{V}  </Text>
          <Text color={tuiColors.amber}>{DIAMOND}</Text>
          <Text color={tuiColors.silver}> {config.nudge.padEnd(cw - 2 - hintSuffix.length)}</Text>
          {hint && (
            <>
              <Text color={tuiColors.amber}>  {hint.key}</Text>
              <Text color={tuiColors.gray}> {hint.label}</Text>
            </>
          )}
          <Text>  </Text>
          <Text color={tuiColors.ghost}>{V}</Text>
        </Text>
        {botBorder}
      </Box>
    );
  }

  // Full empty variant
  const hintsLen = config.hints.reduce((acc, h, i) => acc + h.key.length + 1 + h.label.length + (i > 0 ? 3 : 0), 0);

  return (
    <Box flexDirection="column" paddingX={2} marginTop={1}>
      {topBorder}
      <EmptyRow cw={cw} />

      {/* Title line */}
      <Text>
        <Text color={tuiColors.ghost}>{V}  </Text>
        <Text color={tuiColors.amber}>{DIAMOND}</Text>
        <Text color={tuiColors.white} bold> {config.title}</Text>
        <Text>{' '.repeat(Math.max(0, cw - config.title.length - 2))}</Text>
        <Text>  </Text>
        <Text color={tuiColors.ghost}>{V}</Text>
      </Text>

      <EmptyRow cw={cw} />

      {/* Description lines */}
      {config.description.map((line, i) => (
        <Text key={i}>
          <Text color={tuiColors.ghost}>{V}  </Text>
          <Text color={tuiColors.silver}>{line.padEnd(cw)}</Text>
          <Text>  </Text>
          <Text color={tuiColors.ghost}>{V}</Text>
        </Text>
      ))}

      <EmptyRow cw={cw} />

      {/* Hotkey hints */}
      <Text>
        <Text color={tuiColors.ghost}>{V}  </Text>
        {config.hints.map((h, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Text color={tuiColors.ghost}>{'   '}</Text>}
            <Text color={tuiColors.amber}>{h.key}</Text>
            <Text color={tuiColors.gray}> {h.label}</Text>
          </React.Fragment>
        ))}
        <Text>{' '.repeat(Math.max(0, cw - hintsLen))}</Text>
        <Text>  </Text>
        <Text color={tuiColors.ghost}>{V}</Text>
      </Text>

      <EmptyRow cw={cw} />
      {botBorder}
    </Box>
  );
}
