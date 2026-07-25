/**
 * TUI AgentList — premium agent rows with status chips and live data.
 *
 * Layout per row:
 *   [cursor] [status chip] [name..........] [adapter chip] [task/role..........] [stats..]
 *
 * Design language:
 *   - Background-tinted status chips matching Header aesthetic
 *   - Adapter shown as subtle label chip
 *   - Running agents: spinner inside green chip + current task highlighted
 *   - Stats display: completed/total with color coding
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Agent, AgentStatus } from '../../domain/agent.js';
import type { RunningEntry } from '../../domain/state.js';
import { tuiColors, DOT, LOZENGE, STAR, LOOP, lightRule, capLine } from '../colors.js';
import { Spinner } from './Spinner.js';
import { formatDuration } from '../../cli/output.js';
import { ERROR_HINTS, type AdapterErrorKind } from '../../domain/errors.js';
import { useTuiPalette } from '../paletteContext.js';

/* ── Glyphs ───────────────────────────────────────── */

const FILLED_CIRCLE = '\u25CF';  // ●
const CROSS = '\u2715';          // ✕
const EMPTY_CIRCLE = '\u25CB';   // ○
const TRIANGLE = '\u25B6';       // ▶
const CHECK = '\u2713';          // ✓

/* ── Chip backgrounds ─────────────────────────────── */

/* ── Status chip config ───────────────────────────── */

interface StatusChipConfig {
  icon: string;
  label: string;
  fg: keyof typeof tuiColors;
  bg: keyof typeof tuiColors;
  bold?: boolean;
  spinner?: boolean;
}

const STATUS_CHIP: Record<AgentStatus, StatusChipConfig> = {
  running: { icon: TRIANGLE, label: 'ACTIVE', fg: 'green', bg: 'successBg', bold: true, spinner: true },
  idle: { icon: EMPTY_CIRCLE, label: 'IDLE', fg: 'dim', bg: 'neutralBg' },
  error: { icon: CROSS, label: 'ERROR', fg: 'red', bg: 'errorBg', bold: true },
  disabled: { icon: EMPTY_CIRCLE, label: 'OFF', fg: 'ghost', bg: 'neutralBg' },
};

/** Sort order: running → idle → error → disabled */
export const AGENT_STATUS_ORDER: Record<AgentStatus, number> = {
  running: 0,
  idle: 1,
  error: 2,
  disabled: 3,
};

export interface AgentRowProps {
  agent: Agent;
  selected?: boolean;
  width?: number;
  /** RunningEntry for this agent if currently running a task */
  runningEntry?: RunningEntry;
  /** Title of the current task (resolved from task ID) */
  currentTaskTitle?: string;
  /** Team name this agent belongs to (resolved externally) */
  teamName?: string;
  /** Whether this agent is a team lead */
  isLead?: boolean;
}

export const AgentRow = React.memo(function AgentRow({ agent, selected, width, runningEntry, currentTaskTitle, teamName, isLead }: AgentRowProps) {
  useTuiPalette();
  const chip = STATUS_CHIP[agent.status];
  const isRunning = agent.status === 'running';

  // Time / stats display
  let timeStr: string;
  let timeColor: string | undefined;
  if (isRunning && runningEntry) {
    const ms = Date.now() - new Date(runningEntry.started_at).getTime();
    timeStr = formatDuration(ms);
    timeColor = tuiColors.cyan;
  } else if (agent.stats.total_runs > 0) {
    timeStr = `${agent.stats.tasks_completed}/${agent.stats.total_runs}`;
    timeColor = agent.stats.tasks_completed > 0 ? tuiColors.green : tuiColors.dim;
  } else {
    timeStr = '\u2014'; // —
    timeColor = undefined;
  }

  const cursor = selected ? '\u25B8' : ' '; // ▸ or space

  // Column widths — compact layout: no role column (visible in detail panel)
  const chipWidth = 11;     // " ▶ ACTIVE " = ~11 chars
  const adapterWidth = 8;   // " claude " compact
  const teamColWidth = teamName ? Math.min(teamName.length + 2, 12) : 0;
  const timeWidth = 10;     // "109/114 ✓" with stats
  const fixedCols = 2 + chipWidth + adapterWidth + teamColWidth + timeWidth;
  const nameWidth = width ? Math.max(8, width - fixedCols) : 20;

  // Stats badge for agents with history
  const hasHistory = agent.stats.total_runs > 0;
  const successRate = hasHistory
    ? Math.round((agent.stats.tasks_completed / agent.stats.total_runs) * 100)
    : 0;

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

      {/* Agent name + running task hint */}
      <Box width={nameWidth}>
        <Text
          wrap="truncate"
          bold={selected || isRunning}
          color={selected ? tuiColors.white : isRunning ? tuiColors.green : tuiColors.silver}
        >
          {agent.autonomous && <Text color={tuiColors.cyan}>{LOOP} </Text>}
          {isLead && <Text color={tuiColors.amber}>{STAR} </Text>}
          {agent.name}
          {isRunning && currentTaskTitle && (
            <Text color={tuiColors.dim}> {DOT} {currentTaskTitle}</Text>
          )}
          {agent.status === 'error' && agent.last_error && (
            <Text color={tuiColors.red}> {DOT} {capLine((ERROR_HINTS[agent.last_error.kind as AdapterErrorKind]?.message ?? agent.last_error.message), 30)}</Text>
          )}
        </Text>
      </Box>

      {/* Adapter */}
      <Box width={adapterWidth}>
        <Text color={tuiColors.dim}>{agent.adapter}</Text>
      </Box>

      {/* Team badge */}
      {teamName && (
        <Box width={teamColWidth}>
          <Text color={tuiColors.amber} wrap="truncate">{teamName}</Text>
        </Box>
      )}

      {/* Time / stats */}
      <Box width={timeWidth} justifyContent="flex-end">
        {hasHistory && !isRunning ? (
          <Text color={successRate >= 80 ? tuiColors.green : successRate >= 50 ? tuiColors.yellow : tuiColors.red}>
            {timeStr} {CHECK}
          </Text>
        ) : (
          <Text color={timeColor} dimColor={!timeColor}>{timeStr}</Text>
        )}
      </Box>
    </Box>
  );
});

/* ── Team Section Header ────────────────────────────── */

export interface TeamSectionProps {
  teamName: string;
  memberCount: number;
  leadName?: string;
  width: number;
}

/**
 * Amber-tinted section divider for agent team groups.
 *
 *   ─── ◈ FRONTEND · 2 agents · ★ gamma ──────────────────
 */
export function TeamSectionRow({ teamName, memberCount, leadName, width }: TeamSectionProps) {
  const count = `${memberCount} agent${memberCount !== 1 ? 's' : ''}`;
  const leadStr = leadName ? ` ${DOT} ${STAR} ${leadName}` : '';
  const label = ` ${LOZENGE} ${teamName.toUpperCase()} ${DOT} ${count}${leadStr} `;
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

/* ── Unassigned Section Header ─────────────────────── */

const EMPTY_DIAMOND = '\u25C7';  // ◇

/**
 * Ghost-tinted section divider for agents not in any team.
 *
 *   ─── ◇ UNASSIGNED · 3 agents ──────────────────
 */
export function UnassignedSectionRow({ memberCount, width }: { memberCount: number; width: number }) {
  const count = `${memberCount} agent${memberCount !== 1 ? 's' : ''}`;
  const label = ` ${EMPTY_DIAMOND} UNASSIGNED ${DOT} ${count} `;
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
