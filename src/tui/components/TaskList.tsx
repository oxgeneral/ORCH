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
import type { Goal } from '../../domain/goal.js';
import { tuiColors, DOT, LOZENGE, capLine, lightRule } from '../colors.js';
import { Spinner } from './Spinner.js';
import { formatDuration } from '../../cli/output.js';
import { useTuiPalette } from '../paletteContext.js';

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
const RETRY = '\u21BB';          // ↻
const DASH = '\u2500';           // ─
const TRIANGLE = '\u25B6';       // ▶

interface StatusChipConfig {
  icon: string;
  label: string;
  fg: keyof typeof tuiColors;
  bg: keyof typeof tuiColors;
  bold?: boolean;
  spinner?: boolean;
}

const STATUS_CHIP: Record<TaskStatus, StatusChipConfig> = {
  in_progress: { icon: TRIANGLE, label: 'RUN', fg: 'green', bg: 'successBg', bold: true, spinner: true },
  retrying: { icon: RETRY, label: 'RETRY', fg: 'yellow', bg: 'warnBg', spinner: true },
  review: { icon: LOZENGE, label: 'REVIEW', fg: 'blue', bg: 'toolBg' },
  todo: { icon: EMPTY_CIRCLE, label: 'TODO', fg: 'dim', bg: 'neutralBg' },
  done: { icon: CHECK, label: 'DONE', fg: 'green', bg: 'successBg' },
  failed: { icon: CROSS, label: 'FAIL', fg: 'red', bg: 'errorBg', bold: true },
  cancelled: { icon: DASH, label: 'OFF', fg: 'dim', bg: 'neutralBg' },
};

/* ── Priority pips ────────────────────────────────── */

const PRIORITY_CONFIG: Record<number, { color: keyof typeof tuiColors; label: string }> = {
  1: { color: 'red', label: '!!!' },
  2: { color: 'yellow', label: '!!' },
  3: { color: 'dim', label: '!' },
  4: { color: 'ghost', label: DOT },
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
  /** Map goal ID → Goal for badge display */
  goalMap?: Map<string, Goal>;
}

const GOAL_BADGE_WIDTH = 18; // " ⊕ TRUNCATED_TITLE " = up to 18 chars
export const TaskRow = React.memo(function TaskRow({ task, selected, width, agentNameMap, goalMap }: TaskRowProps) {
  useTuiPalette();
  const chip = STATUS_CHIP[task.status];
  const isRunning = task.status === 'in_progress' || task.status === 'retrying';
  const priConf = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG[4]!;

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

  // Goal badge
  const goal = task.goalId ? goalMap?.get(task.goalId) : undefined;
  const hasGoalBadge = !!goal;

  // Column widths
  const chipWidth = 10;     // " ▶ RUN  " = 10 chars with padding
  const priWidth = 4;       // "!!! " or "·   "
  const assigneeWidth = 14;
  const goalBadgeW = hasGoalBadge ? GOAL_BADGE_WIDTH : 0;
  const timeWidth = 7;
  const fixedCols = 2 + chipWidth + priWidth + assigneeWidth + goalBadgeW + timeWidth;
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
        <Text backgroundColor={tuiColors[chip.bg]} color={tuiColors[chip.fg]} bold={chip.bold}>
          {chip.spinner ? (
            <>{' '}<Spinner color={tuiColors[chip.fg]} /> {chip.label}{' '}</>
          ) : (
            <>{' '}{chip.icon} {chip.label}{' '}</>
          )}
        </Text>
      </Box>

      {/* Priority indicator */}
      <Box width={priWidth}>
        <Text color={tuiColors[priConf.color]} bold={task.priority <= 2}>
          {priConf.label}
        </Text>
      </Box>

      {/* Title (truncated to column width) + attachment indicator */}
      <Box width={titleWidth}>
        <Text
          wrap="truncate"
          bold={selected || isRunning}
          color={selected ? tuiColors.white : isRunning ? tuiColors.silver : undefined}
        >
          {task.title.length > titleWidth ? task.title.slice(0, titleWidth - 1) + '\u2026' : task.title}
        </Text>
        {(task.attachments?.length ?? 0) > 0 && (
          <Text color={tuiColors.dim}> {'\uD83D\uDCCE'}{task.attachments!.length}</Text>
        )}
      </Box>

      {/* Goal badge */}
      {hasGoalBadge && (
        <Box width={goalBadgeW}>
          <Text backgroundColor={tuiColors.accentBg} color={tuiColors.amberDim} wrap="truncate">
            {' \u2295 '}{capLine(goal.title, 13)}{' '}
          </Text>
        </Box>
      )}

      {/* Assignee chip (truncated to column width) */}
      <Box width={assigneeWidth}>
        {assigneeName ? (
          <Text backgroundColor={tuiColors.successBg} color={tuiColors.green} wrap="truncate">
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
});

// Attach Row as static property for use in App's custom layout
TaskList.Row = TaskRow;

/* ── Goal section header (matches TeamSectionRow style) ── */

const CIRCLE_PLUS = '\u2295'; // ⊕

interface GoalSectionProps {
  goalTitle: string;
  taskCount: number;
  doneCount: number;
  width: number;
}

export function GoalSectionRow({ goalTitle, taskCount, doneCount, width }: GoalSectionProps) {
  const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;
  const label = ` ${CIRCLE_PLUS} ${goalTitle.toUpperCase()} ${DOT} ${taskCount} task${taskCount !== 1 ? 's' : ''} ${DOT} ${pct}% done `;
  const leftLen = 3;
  const rightLen = Math.max(0, width - leftLen - label.length - 4); // -4 for paddingX=2

  return (
    <Box paddingX={2}>
      <Text color={tuiColors.ghost}>{lightRule(leftLen)}</Text>
      <Text backgroundColor={tuiColors.accentBg} color={tuiColors.amber} bold>{label}</Text>
      <Text color={tuiColors.ghost}>{lightRule(rightLen)}</Text>
    </Box>
  );
}

export function UngroupedSectionRow({ taskCount, width }: { taskCount: number; width: number }) {
  const label = ` ${CIRCLE_PLUS} UNGROUPED ${DOT} ${taskCount} task${taskCount !== 1 ? 's' : ''} `;
  const leftLen = 3;
  const rightLen = Math.max(0, width - leftLen - label.length - 4);

  return (
    <Box paddingX={2}>
      <Text color={tuiColors.ghost}>{lightRule(leftLen)}</Text>
      <Text backgroundColor={tuiColors.neutralBg} color={tuiColors.dim}>{label}</Text>
      <Text color={tuiColors.ghost}>{lightRule(rightLen)}</Text>
    </Box>
  );
}

// Re-export sort order for use in App
export { STATUS_ORDER };
