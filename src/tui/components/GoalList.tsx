/**
 * TUI GoalList — goal rows with status chips and visual hierarchy.
 *
 * Layout per row:
 *   [cursor] [status chip  ] [title........................] [assignee chip] [time  ]
 *
 * Design language:
 *   - Background-tinted status chips matching Tasks aesthetic
 *   - Active goals: green chip, achieved: amber, abandoned/paused: neutral
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Goal, GoalStatus } from '../../domain/goal.js';
import { tuiColors, DOT } from '../colors.js';

/* ── Glyphs ───────────────────────────────────────── */

const CHECK = '\u2713';          // ✓
const CROSS = '\u2715';          // ✕
const PAUSE = '\u2016';          // ‖
const TARGET = '\u25C9';         // ◉

/* ── Chip backgrounds ─────────────────────────────── */

const chipBg = {
  green:   '#0f2d1f',
  amber:   '#2d1f0a',
  neutral: '#1a1a22',
  red:     '#2d0f0f',
} as const;

/* ── Status chip config ───────────────────────────── */

interface StatusChipConfig {
  icon: string;
  label: string;
  fg: string;
  bg: string;
  bold?: boolean;
}

const STATUS_CHIP: Record<GoalStatus, StatusChipConfig> = {
  active:    { icon: TARGET,       label: 'ACTIVE',  fg: tuiColors.green,  bg: chipBg.green, bold: true },
  paused:    { icon: PAUSE,        label: 'PAUSED',  fg: tuiColors.dim,    bg: chipBg.neutral },
  achieved:  { icon: CHECK,        label: 'DONE',    fg: tuiColors.amber,  bg: chipBg.amber,  bold: true },
  abandoned: { icon: CROSS,        label: 'DROP',    fg: tuiColors.ghost,  bg: chipBg.neutral },
};

/** Sort order: active → paused → achieved → abandoned */
export const GOAL_STATUS_ORDER: Record<GoalStatus, number> = {
  active: 0,
  paused: 1,
  achieved: 2,
  abandoned: 3,
};

/* ── GoalRow ──────────────────────────────────────── */

export interface GoalRowProps {
  goal: Goal;
  selected?: boolean;
  width?: number;
  agentNameMap?: Map<string, string>;
}

export function GoalRow({ goal, selected, width, agentNameMap }: GoalRowProps) {
  const chip = STATUS_CHIP[goal.status];

  const cursor = selected ? '\u25B8' : ' '; // ▸ or space

  // Column widths
  const chipWidth = 11;
  const assigneeWidth = 14;
  const timeWidth = 7;
  const fixedCols = 2 + chipWidth + assigneeWidth + timeWidth;
  const titleWidth = width ? Math.max(10, width - fixedCols) : 40;

  // Assignee display
  const assigneeName = goal.assignee
    ? (agentNameMap?.get(goal.assignee) ?? goal.assignee)
    : undefined;

  // Time display
  let timeStr: string;
  let timeColor: string | undefined;
  if (goal.status === 'achieved') {
    timeStr = CHECK;
    timeColor = tuiColors.amber;
  } else if (goal.status === 'abandoned') {
    timeStr = CROSS;
    timeColor = tuiColors.ghost;
  } else {
    // Show age for active/paused
    const ms = Date.now() - new Date(goal.created_at).getTime();
    const days = Math.floor(ms / 86400000);
    timeStr = days > 0 ? `${days}d` : '<1d';
    timeColor = tuiColors.dim;
  }

  return (
    <Box>
      {/* Cursor */}
      <Text color={selected ? tuiColors.amber : undefined}>{cursor} </Text>

      {/* Status chip */}
      <Box width={chipWidth}>
        <Text backgroundColor={chip.bg} color={chip.fg} bold={chip.bold}>
          {' '}{chip.icon} {chip.label}{' '}
        </Text>
      </Box>

      {/* Title */}
      <Box width={titleWidth}>
        <Text
          wrap="truncate"
          bold={selected || goal.status === 'active'}
          color={selected ? tuiColors.white : goal.status === 'active' ? tuiColors.silver : undefined}
        >
          {goal.title.length > titleWidth ? goal.title.slice(0, titleWidth - 1) + '\u2026' : goal.title}
        </Text>
      </Box>

      {/* Assignee chip */}
      <Box width={assigneeWidth}>
        {assigneeName ? (
          <Text backgroundColor={chipBg.green} color={tuiColors.green} wrap="truncate">
            {' '}{assigneeName.length > assigneeWidth - 2 ? assigneeName.slice(0, assigneeWidth - 3) + '\u2026' : assigneeName}{' '}
          </Text>
        ) : (
          <Text color={tuiColors.ghost}>{'\u2014'}</Text>
        )}
      </Box>

      {/* Time / age */}
      <Box width={timeWidth} justifyContent="flex-end">
        <Text color={timeColor} dimColor={!timeColor}>{timeStr}</Text>
      </Box>
    </Box>
  );
}

/* ── GoalList ─────────────────────────────────────── */

export interface GoalListProps {
  goals: Goal[];
  selectedIndex?: number;
}

export function GoalList({ goals, selectedIndex }: GoalListProps) {
  const sorted = [...goals].sort(
    (a, b) => (GOAL_STATUS_ORDER[a.status] ?? 9) - (GOAL_STATUS_ORDER[b.status] ?? 9),
  );

  if (sorted.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text dimColor>No goals. Press N to create one or run: orch goal add &quot;...&quot;</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      {sorted.map((goal, i) => (
        <GoalRow key={goal.id} goal={goal} selected={i === selectedIndex} />
      ))}
    </Box>
  );
}

