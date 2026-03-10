/**
 * TUI TaskList — premium task rows with status chips and visual hierarchy.
 *
 * Layout per row:
 *   [cursor] [status chip  ] [title........................] [assignee chip] [time  ]
 *
 * Design language:
 *   - Background-tinted status chips (dark bg + colored text)
 *   - Priority pip indicators (colored dots instead of P1/P2)
 *   - Selected row: amber cursor + bold white title + subtle row highlight
 *   - Running tasks: inline spinner inside status chip
 *   - Attempt counter badge for retrying tasks
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Task, TaskStatus } from '../../domain/task.js';
import { tuiColors, DOT } from '../colors.js';
import { Spinner } from './Spinner.js';
import { formatDuration } from '../../cli/output.js';

// Status sort order: running → retrying → review → todo → done → failed → cancelled
const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  retrying: 1,
  review: 2,
  todo: 3,
  done: 4,
  failed: 5,
  cancelled: 6,
};

/* ── Status chip config ────────────────────────────── */

const FILLED_CIRCLE = '\u25CF';  // ●
const EMPTY_CIRCLE = '\u25CB';   // ○
const CHECK = '\u2713';          // ✓
const CROSS = '\u2715';          // ✕
const LOZENGE = '\u25C8';        // ◈
const RETRY = '\u21BB';          // ↻
const DASH = '\u2500';           // ─
const TRIANGLE = '\u25B6';       // ▶

const chipBg = {
  green:   '#0f2d1f',
  blue:    '#0f1f2d',
  yellow:  '#2d2a0f',
  red:     '#2d0f0f',
  neutral: '#1a1a22',
  amber:   '#2d1f0a',
} as const;

interface StatusChipConfig {
  icon: string;
  label: string;
  fg: string;
  bg: string;
  bold?: boolean;
  spinner?: boolean;
}

const STATUS_CHIP: Record<TaskStatus, StatusChipConfig> = {
  in_progress: { icon: TRIANGLE, label: 'RUN',    fg: tuiColors.green,  bg: chipBg.green,   bold: true, spinner: true },
  retrying:    { icon: RETRY,    label: 'RETRY',   fg: tuiColors.yellow, bg: chipBg.yellow,  spinner: true },
  review:      { icon: LOZENGE,  label: 'REVIEW',  fg: tuiColors.blue,   bg: chipBg.blue },
  todo:        { icon: EMPTY_CIRCLE, label: 'TODO', fg: tuiColors.dim,   bg: chipBg.neutral },
  done:        { icon: CHECK,    label: 'DONE',    fg: tuiColors.green,  bg: chipBg.green },
  failed:      { icon: CROSS,    label: 'FAIL',    fg: tuiColors.red,    bg: chipBg.red,     bold: true },
  cancelled:   { icon: DASH,     label: 'OFF',     fg: tuiColors.dim,    bg: chipBg.neutral },
};

/* ── Priority pips ────────────────────────────────── */

const PRIORITY_CONFIG: Record<number, { color: string; label: string }> = {
  1: { color: tuiColors.red,    label: '!!!' },
  2: { color: tuiColors.yellow, label: '!!' },
  3: { color: tuiColors.dim,    label: '!' },
  4: { color: tuiColors.ghost,  label: DOT },
};

/* ── Exports ──────────────────────────────────────── */

export interface TaskListProps {
  tasks: Task[];
  selectedIndex?: number;
}

export function TaskList({ tasks, selectedIndex }: TaskListProps) {
  const sorted = [...tasks].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
  );

  if (sorted.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text dimColor>No tasks. Run: orch task add &quot;...&quot;</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      {sorted.map((task, i) => (
        <TaskRow key={task.id} task={task} selected={i === selectedIndex} />
      ))}
    </Box>
  );
}

export interface TaskRowProps {
  task: Task;
  selected?: boolean;
  width?: number;
  /** Map agent ID → agent name for display */
  agentNameMap?: Map<string, string>;
}

export function TaskRow({ task, selected, width, agentNameMap }: TaskRowProps) {
  const chip = STATUS_CHIP[task.status];
  const isRunning = task.status === 'in_progress' || task.status === 'retrying';
  const priConf = PRIORITY_CONFIG[task.priority] ?? { color: tuiColors.ghost, label: DOT };

  // Time display
  let timeStr: string;
  let timeColor: string | undefined;
  if (task.status === 'done') {
    timeStr = CHECK;
    timeColor = tuiColors.green;
  } else if (task.status === 'failed') {
    timeStr = CROSS;
    timeColor = tuiColors.red;
  } else if (isRunning) {
    const ms = Date.now() - new Date(task.updated_at).getTime();
    timeStr = formatDuration(ms);
    timeColor = tuiColors.cyan;
  } else {
    timeStr = '\u2014'; // —
    timeColor = undefined;
  }

  const cursor = selected ? '\u25B8' : ' '; // ▸ or space

  // Column widths
  const chipWidth = 10;     // " ▶ RUN  " = 10 chars with padding
  const priWidth = 4;       // "!!! " or "·   "
  const assigneeWidth = 14;
  const timeWidth = 7;
  const fixedCols = 2 + chipWidth + priWidth + assigneeWidth + timeWidth; // cursor(2) + chip + pri + assignee + time
  const titleWidth = width ? Math.max(10, width - fixedCols) : 40;

  // Assignee display
  const assigneeName = task.assignee
    ? (agentNameMap?.get(task.assignee) ?? task.assignee)
    : undefined;

  return (
    <Box>
      {/* Cursor */}
      <Text color={selected ? tuiColors.amber : undefined}>{cursor} </Text>

      {/* Status chip with background */}
      <Box width={chipWidth}>
        <Text backgroundColor={chip.bg} color={chip.fg} bold={chip.bold}>
          {chip.spinner ? (
            <>{' '}<Spinner color={chip.fg} /> {chip.label}{' '}</>
          ) : (
            <>{' '}{chip.icon} {chip.label}{' '}</>
          )}
        </Text>
      </Box>

      {/* Priority indicator */}
      <Box width={priWidth}>
        <Text color={priConf.color} bold={task.priority <= 2}>
          {priConf.label}
        </Text>
      </Box>

      {/* Title (truncated to column width) */}
      <Box width={titleWidth}>
        <Text
          wrap="truncate"
          bold={selected || isRunning}
          color={selected ? tuiColors.white : isRunning ? tuiColors.silver : undefined}
        >
          {task.title.length > titleWidth ? task.title.slice(0, titleWidth - 1) + '\u2026' : task.title}
        </Text>
      </Box>

      {/* Assignee chip (truncated to column width) */}
      <Box width={assigneeWidth}>
        {assigneeName ? (
          <Text backgroundColor={chipBg.green} color={tuiColors.green} wrap="truncate">
            {' '}{assigneeName.length > assigneeWidth - 2 ? assigneeName.slice(0, assigneeWidth - 3) + '\u2026' : assigneeName}{' '}
          </Text>
        ) : (
          <Text color={tuiColors.ghost}>{'\u2014'}</Text>
        )}
      </Box>

      {/* Time / status */}
      <Box width={timeWidth} justifyContent="flex-end">
        <Text color={timeColor} dimColor={!timeColor}>{timeStr}</Text>
      </Box>
    </Box>
  );
}

// Attach Row as static property for use in App's custom layout
TaskList.Row = TaskRow;

// Re-export sort order for use in App
export { STATUS_ORDER };
