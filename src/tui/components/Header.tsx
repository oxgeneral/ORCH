/**
 * TUI Header — "Mission Control" premium header.
 *
 * 3-line layout that dominates the top of the screen:
 *
 *   Line 1 (Brand):   ◈ ORCH · project-name · main      [ T TASKS ]  A agents  L logs       ● WATCHING  14m
 *   Line 2 (Stats):   [ ⠹ 2 RUNNING ] [ ◈ 1 REVIEW ] [ ○ 3 TODO ] [ ✓ 1 DONE ]   ▁▃▅▇▅▃  ↑4k ↓10k · Σ14k
 *   Line 3 (Bar):     ━━━━━━━━━━━━━━━━━━░░▓▓▓▓░░━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Key visual features:
 *   - Background-colored chips for status badges (dark tinted backgrounds)
 *   - Inverted active tab (amber bg, dark text)
 *   - Animated scanner bar when agents are running (bright segment sweeps L→R)
 *   - Pulsing logo diamond
 *   - Inline braille spinner next to running count
 *   - Unicode sparkline for token throughput
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { tuiColors, HEAVY_RULE, DOT } from '../colors.js';
import type { ViewId } from './TabBar.js';

/* ══════════════════════════════════════════════════════════
   CONSTANTS & GLYPHS
   ══════════════════════════════════════════════════════════ */

const DIAMOND = '\u25C6';            // ◆
const FILLED_CIRCLE = '\u25CF';      // ●
const EMPTY_CIRCLE = '\u25CB';       // ○
const CHECK = '\u2713';              // ✓
const CROSS = '\u2715';              // ✕
const LOZENGE = '\u25C8';            // ◈
const ARROW_UP = '\u2191';           // ↑
const ARROW_DOWN = '\u2193';         // ↓
const SIGMA = '\u03A3';              // Σ
const TRIANGLE_RIGHT = '\u25B6';     // ▶
const RETRY_ICON = '\u21BB';         // ↻
const BRAILLE_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
const SPARK_CHARS = [' ', '\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

/* ══════════════════════════════════════════════════════════
   CHIP BACKGROUND COLORS (very dark tints for terminal)
   ══════════════════════════════════════════════════════════ */

const chipBg = {
  green:   '#0f2d1f',  // dark emerald tint
  blue:    '#0f1f2d',  // dark sky tint
  yellow:  '#2d2a0f',  // dark amber tint
  red:     '#2d0f0f',  // dark rose tint
  neutral: '#1a1a22',  // dark slate
  amber:   '#2d1f0a',  // dark warm
} as const;

/* ══════════════════════════════════════════════════════════
   ANIMATED PRIMITIVES
   ══════════════════════════════════════════════════════════ */

/** Braille spinner — cycles at 120ms (Ink-friendly rate to avoid flicker) */
function MiniSpinner({ color }: { color: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length), 120);
    return () => clearInterval(t);
  }, []);
  return <Text color={color}>{BRAILLE_FRAMES[frame]}</Text>;
}

/** Pulsing logo diamond — alternates between bright and dim amber */
function PulsingDiamond() {
  const [bright, setBright] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setBright((b) => !b), 1200);
    return () => clearInterval(t);
  }, []);
  return <Text color={bright ? tuiColors.amber : tuiColors.amberDim} bold>{DIAMOND}</Text>;
}

/**
 * Scanner progress bar — bright segment sweeps across when active.
 *
 * Uses a single pre-built string to minimize React re-render overhead.
 * Interval is 120ms (~8 FPS) to avoid terminal flicker — Ink redraws
 * the entire stdout on each state change, so fast timers cause tearing.
 */
function ScannerBar({ width, active }: { width: number; active: boolean }) {
  const segLen = Math.max(4, Math.floor(width * 0.08));
  const step = 2; // move 2 chars per tick for smooth-looking speed at lower FPS
  const [pos, setPos] = useState(0);
  const totalFrames = Math.ceil((width + segLen) / step);

  useEffect(() => {
    if (!active) { setPos(0); return; }
    const t = setInterval(() => setPos((p) => (p + 1) % (totalFrames * 2)), 120);
    return () => clearInterval(t);
  }, [active, totalFrames]);

  if (!active) {
    return (
      <Box paddingX={1}>
        <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(width)}</Text>
      </Box>
    );
  }

  // Bounce position: 0→totalFrames→0, scaled by step
  const rawPos = pos < totalFrames ? pos * step : (totalFrames * 2 - pos) * step;
  const brightStart = Math.max(0, rawPos - segLen);
  const brightEnd = Math.min(width, rawPos);

  // Build a single string with ANSI color codes embedded via Ink's <Text>
  // Use only 3 segments to minimize Text elements: before | bright | after
  const beforeLen = brightStart;
  const brightLen = Math.max(0, brightEnd - brightStart);
  const afterLen = Math.max(0, width - brightEnd);

  return (
    <Box paddingX={1}>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(beforeLen)}</Text>
      <Text color={tuiColors.amber}>{HEAVY_RULE.repeat(brightLen)}</Text>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(afterLen)}</Text>
    </Box>
  );
}

/** Sparkline — mini bar chart using 1/8-height block chars */
function Sparkline({ data, width, color }: { data: number[]; width: number; color: string }) {
  if (data.length === 0) return null;
  const display = data.slice(-width);
  const max = Math.max(...display, 1);
  const chars = display.map((v) => {
    const idx = Math.round((v / max) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[idx] ?? SPARK_CHARS[0]!;
  }).join('');
  return <Text color={color}>{chars}</Text>;
}

/* ══════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════ */

export interface HeaderStats {
  running: number;
  retrying: number;
  review: number;
  todo: number;
  done: number;
  failed: number;
  cancelled: number;
}

export interface HeaderTokens {
  input: number;
  output: number;
  total: number;
}

export interface HeaderProps {
  projectName: string;
  activeView: ViewId;
  mode: 'watching' | 'idle';
  stats: HeaderStats;
  tokens: HeaderTokens;
  uptime?: string;
  width: number;
  sparklineData?: number[];
}

/* ══════════════════════════════════════════════════════════
   TAB CONFIG
   ══════════════════════════════════════════════════════════ */

const TABS: Array<{ key: string; id: ViewId; label: string }> = [
  { key: 'T', id: 'tasks', label: 'TASKS' },
  { key: 'A', id: 'agents', label: 'AGENTS' },
  { key: 'O', id: 'office', label: 'OFFICE' },
  { key: 'L', id: 'logs', label: 'ACTIONS' },
];

/* ══════════════════════════════════════════════════════════
   LINE 1: BRAND + TABS + MODE
   ══════════════════════════════════════════════════════════ */

function BrandBar({
  projectName, activeView, mode, stats, uptime, width,
}: Pick<HeaderProps, 'projectName' | 'activeView' | 'mode' | 'stats' | 'uptime' | 'width'>) {
  const isWatching = mode === 'watching';

  return (
    <Box paddingX={1} justifyContent="space-between" width={width}>
      {/* ── Left: Logo + Project ── */}
      <Box gap={0}>
        <PulsingDiamond />
        <Text color={tuiColors.amber} bold> ORCH</Text>
        <Text color={tuiColors.ghost}> {DOT} </Text>
        <Text color={tuiColors.silver}>{projectName}</Text>
      </Box>

      {/* ── Center: Tabs ── */}
      <Box gap={0}>
        {TABS.map((tab, i) => {
          const isActive = activeView === tab.id;
          return (
            <React.Fragment key={tab.id}>
              {i > 0 && <Text>{'  '}</Text>}
              {isActive ? (
                // Active tab: inverted chip — amber background, dark text
                <Text backgroundColor={tuiColors.amber} color="#0a0a0c" bold>
                  {' '}{tab.key} {tab.label}{' '}
                </Text>
              ) : (
                // Inactive tab: ghost key + dim label
                <Box gap={0}>
                  <Text color={tuiColors.ghost}>{tab.key}</Text>
                  <Text color={tuiColors.dim}> {tab.label.toLowerCase()}</Text>
                </Box>
              )}
            </React.Fragment>
          );
        })}
      </Box>

      {/* ── Right: Mode + Uptime ── */}
      <Box gap={0}>
        {isWatching ? (
          <Text backgroundColor={chipBg.green} color={tuiColors.green} bold>
            {' '}{FILLED_CIRCLE} WATCHING{' '}
          </Text>
        ) : (
          <Text backgroundColor={chipBg.neutral} color={tuiColors.dim}>
            {' '}{EMPTY_CIRCLE} IDLE{' '}
          </Text>
        )}
        {stats.running > 0 && (
          <>
            <Text> </Text>
            <Text backgroundColor={chipBg.green} color={tuiColors.green}>
              {' '}<MiniSpinner color={tuiColors.green} /> {stats.running} active{' '}
            </Text>
          </>
        )}
        {uptime && (
          <Text color={tuiColors.ghost}> {uptime}</Text>
        )}
      </Box>
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════
   LINE 2: STATUS CHIPS + SPARKLINE + TOKENS
   ══════════════════════════════════════════════════════════ */

interface ChipDef {
  icon: string;
  label: string;
  count: number;
  fg: string;
  bg: string;
  bold?: boolean;
  spinner?: boolean;
}

function StatsBar({
  stats, tokens, width, sparklineData,
}: Pick<HeaderProps, 'stats' | 'tokens' | 'width' | 'sparklineData'>) {

  const allChips: Array<ChipDef & { show: boolean }> = [
    { icon: TRIANGLE_RIGHT, label: 'RUN', count: stats.running, fg: tuiColors.green, bg: chipBg.green, bold: true, spinner: true, show: stats.running > 0 },
    { icon: RETRY_ICON, label: 'RETRY', count: stats.retrying, fg: tuiColors.yellow, bg: chipBg.yellow, show: stats.retrying > 0 },
    { icon: LOZENGE, label: 'REVIEW', count: stats.review, fg: tuiColors.blue, bg: chipBg.blue, show: stats.review > 0 },
    { icon: EMPTY_CIRCLE, label: 'TODO', count: stats.todo, fg: tuiColors.dim, bg: chipBg.neutral, show: stats.todo > 0 },
    { icon: CHECK, label: 'DONE', count: stats.done, fg: tuiColors.green, bg: chipBg.green, show: stats.done > 0 },
    { icon: CROSS, label: 'FAIL', count: stats.failed, fg: tuiColors.red, bg: chipBg.red, bold: true, show: stats.failed > 0 },
  ];
  const chips = allChips.filter((c) => c.show);

  /* Token formatting */
  const hasTokens = tokens.total > 0;
  const fmtK = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  /* Sparkline */
  const sparkWidth = sparklineData && sparklineData.length > 0 ? Math.min(16, sparklineData.length) : 0;

  return (
    <Box paddingX={1} justifyContent="space-between" width={width}>
      {/* ── Left: Status chips ── */}
      <Box gap={1}>
        {chips.map((chip) => (
          <Text key={chip.label} backgroundColor={chip.bg} color={chip.fg} bold={chip.bold}>
            {chip.spinner ? (
              <>{' '}<MiniSpinner color={chip.fg} /> {chip.count} {chip.label}{' '}</>
            ) : (
              <>{' '}{chip.icon} {chip.count} {chip.label}{' '}</>
            )}
          </Text>
        ))}
        {chips.length === 0 && (
          <Text backgroundColor={chipBg.neutral} color={tuiColors.dim}>{' '}NO TASKS{' '}</Text>
        )}
      </Box>

      {/* ── Right: Sparkline + Token counters ── */}
      <Box gap={0}>
        {sparkWidth > 0 && sparklineData && (
          <>
            <Sparkline data={sparklineData} width={sparkWidth} color={tuiColors.amberDim} />
            <Text>{'  '}</Text>
          </>
        )}
        {hasTokens && (
          <Text backgroundColor={chipBg.amber} color={tuiColors.cyan}>
            {' '}{ARROW_UP}{fmtK(tokens.input)} {ARROW_DOWN}{fmtK(tokens.output)} {DOT} {SIGMA}{fmtK(tokens.total)}{' '}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════
   HEADER — Combined 3-line Export
   ══════════════════════════════════════════════════════════ */

export function Header(props: HeaderProps) {
  const barWidth = Math.max(10, props.width - 2);
  const isActive = props.stats.running > 0;

  return (
    <Box flexDirection="column">
      {/* Top breathing room */}
      <Box height={1} />
      <BrandBar
        projectName={props.projectName}
        activeView={props.activeView}
        mode={props.mode}
        stats={props.stats}
        uptime={props.uptime}
        width={props.width}
      />
      {/* Space between brand and stats */}
      <Box height={1} />
      <StatsBar
        stats={props.stats}
        tokens={props.tokens}
        width={props.width}
        sparklineData={props.sparklineData}
      />
      <ScannerBar width={barWidth} active={isActive} />
    </Box>
  );
}
