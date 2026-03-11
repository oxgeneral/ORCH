/**
 * TUI Office View — gamified agent activity visualization.
 *
 * Renders agents as "employees" in a virtual office with:
 *   - ASCII art workstations/cubicles per agent
 *   - Rank & level system based on completed tasks
 *   - XP progress bars
 *   - Streak counters (consecutive successes)
 *   - Status-specific animations (typing, idle, error sparks)
 *   - Achievement badges
 *   - Leaderboard ranking
 *
 * Aesthetic: retro-futuristic corporate HQ — think Fallout's Vault-Tec
 * meets a startup dashboard. Monospace pixel-art cubicles, neon accents,
 * progress bars with block characters, and rank insignias.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Agent } from '../../domain/agent.js';
import type { OrchestratorState } from '../../domain/state.js';
import type { Task } from '../../domain/task.js';
import { tuiColors, HEAVY_RULE, DOT } from '../colors.js';
import { formatDuration, formatTokens } from '../../cli/output.js';

/* ══════════════════════════════════════════════════════════
   CONSTANTS & GLYPHS
   ══════════════════════════════════════════════════════════ */

const RANK_TITLES = [
  { min: 0,   title: 'Intern',        icon: '\u2022' },     // •
  { min: 3,   title: 'Junior',        icon: '\u25CB' },     // ○
  { min: 8,   title: 'Mid',           icon: '\u25CF' },     // ●
  { min: 15,  title: 'Senior',        icon: '\u25C6' },     // ◆
  { min: 25,  title: 'Lead',          icon: '\u2605' },     // ★
  { min: 40,  title: 'Staff',         icon: '\u2726' },     // ✦ (alt: ✶)
  { min: 60,  title: 'Principal',     icon: '\u2736' },     // ✶
  { min: 100, title: 'Distinguished', icon: '\u2738' },     // ✸
] as const;

const ACHIEVEMENTS: Array<{
  id: string;
  test: (a: Agent) => boolean;
  icon: string;
  label: string;
  color: string;
}> = [
  { id: 'first_blood',  test: (a) => a.stats.tasks_completed >= 1,  icon: '\u2694', label: 'First Blood',   color: tuiColors.green },
  { id: 'streak_3',     test: (a) => getStreak(a) >= 3,             icon: '\u26A1', label: '3x Streak',     color: tuiColors.yellow },
  { id: 'streak_5',     test: (a) => getStreak(a) >= 5,             icon: '\u2604', label: '5x Streak',     color: tuiColors.amber },
  { id: 'workhorse',    test: (a) => a.stats.total_runs >= 10,      icon: '\u2699', label: 'Workhorse',     color: tuiColors.cyan },
  { id: 'flawless',     test: (a) => a.stats.tasks_completed >= 5 && a.stats.tasks_failed === 0, icon: '\u2B50', label: 'Flawless', color: '#ffd700' },
  { id: 'veteran',      test: (a) => a.stats.tasks_completed >= 20, icon: '\u2655', label: 'Veteran',       color: tuiColors.purple },
  { id: 'speedster',    test: (a) => a.stats.total_runs > 0 && (a.stats.total_runtime_ms / a.stats.total_runs) < 30000, icon: '\u21AF', label: 'Speedster', color: tuiColors.green },
  { id: 'resilient',    test: (a) => a.stats.tasks_failed >= 3 && a.stats.tasks_completed > a.stats.tasks_failed, icon: '\u2622', label: 'Resilient', color: tuiColors.blue },
];

/** Estimate streak from success ratio (simplified — real streak needs run history) */
function getStreak(a: Agent): number {
  // Approximate: if no failures recently, streak = completed
  // In practice would need run history; here we use a heuristic
  if (a.stats.tasks_failed === 0) return a.stats.tasks_completed;
  const ratio = a.stats.tasks_completed / Math.max(1, a.stats.total_runs);
  return Math.floor(ratio * a.stats.tasks_completed);
}

/** Success rate as 0–100 integer */
function calcSuccessRate(a: Agent): number {
  return a.stats.total_runs > 0
    ? Math.round((a.stats.tasks_completed / a.stats.total_runs) * 100)
    : 0;
}

type RankDef = { min: number; title: string; icon: string };

function getRank(completed: number): RankDef {
  let rank: RankDef = RANK_TITLES[0]!;
  for (const r of RANK_TITLES) {
    if (completed >= r.min) rank = r;
  }
  return rank;
}

function getNextRank(completed: number): RankDef | null {
  for (const r of RANK_TITLES) {
    if (completed < r.min) return r;
  }
  return null;
}

/** XP needed for next rank */
function getXpProgress(completed: number): { current: number; needed: number; pct: number } {
  const rank = getRank(completed);
  const next = getNextRank(completed);
  if (!next) return { current: completed, needed: completed, pct: 1 };
  const current = completed - rank.min;
  const needed = next.min - rank.min;
  return { current, needed, pct: current / needed };
}

/* ══════════════════════════════════════════════════════════
   ANIMATED PRIMITIVES
   ══════════════════════════════════════════════════════════ */

const TYPING_FRAMES = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588', '\u2587', '\u2586', '\u2585', '\u2584', '\u2583', '\u2582'];
const IDLE_FRAMES = ['\u00B7', '\u2022', '\u00B7', ' '];
const ERROR_FRAMES = ['\u26A1', '\u2715', '\u26A1', ' '];

function TypingIndicator({ color }: { color: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % TYPING_FRAMES.length), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <Text color={color}>
      {TYPING_FRAMES[frame % TYPING_FRAMES.length]}
      {TYPING_FRAMES[(frame + 2) % TYPING_FRAMES.length]}
      {TYPING_FRAMES[(frame + 4) % TYPING_FRAMES.length]}
      {TYPING_FRAMES[(frame + 6) % TYPING_FRAMES.length]}
    </Text>
  );
}

function IdleIndicator() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % IDLE_FRAMES.length), 600);
    return () => clearInterval(t);
  }, []);
  return <Text color={tuiColors.dim}> {IDLE_FRAMES[frame]} </Text>;
}

function ErrorIndicator() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % ERROR_FRAMES.length), 300);
    return () => clearInterval(t);
  }, []);
  return <Text color={tuiColors.red}>{ERROR_FRAMES[frame]}</Text>;
}

/* ══════════════════════════════════════════════════════════
   PROGRESS BAR
   ══════════════════════════════════════════════════════════ */

const BAR_FILL = '\u2588';   // █
const BAR_MID = '\u2593';    // ▓
const BAR_LOW = '\u2591';    // ░
const BAR_EMPTY = '\u2500';  // ─

function ProgressBar({ pct, width, color, bgColor }: {
  pct: number; width: number; color: string; bgColor?: string;
}) {
  const filled = Math.floor(pct * width);
  const partial = pct * width - filled;
  const partialChar = partial > 0.66 ? BAR_MID : partial > 0.33 ? BAR_LOW : '';
  const emptyLen = Math.max(0, width - filled - (partialChar ? 1 : 0));
  return (
    <Text>
      <Text color={color}>{BAR_FILL.repeat(filled)}</Text>
      {partialChar && <Text color={color}>{partialChar}</Text>}
      <Text color={bgColor ?? tuiColors.ghost}>{BAR_EMPTY.repeat(emptyLen)}</Text>
    </Text>
  );
}

/* ══════════════════════════════════════════════════════════
   AGENT CARD (CUBICLE)
   ══════════════════════════════════════════════════════════ */

const AGENT_PALETTE = [
  '#5faf87', '#5fafd7', '#af87ff', '#d7af00',
  '#5fd7d7', '#d787af', '#afaf5f', '#d7875f',
] as const;

function getAgentAccent(idx: number): string {
  return AGENT_PALETTE[idx % AGENT_PALETTE.length]!;
}

/** Status styling — single composite map instead of 4 parallel maps */
const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string; icon: string }> = {
  running:  { bg: '#0f2d1f', fg: tuiColors.green, label: 'WORKING',   icon: '\u25B6' },
  idle:     { bg: '#1a1a22', fg: tuiColors.dim,   label: 'AVAILABLE', icon: '\u25CB' },
  error:    { bg: '#2d0f0f', fg: tuiColors.red,   label: 'ERROR',     icon: '\u2715' },
  disabled: { bg: '#1a1a1a', fg: tuiColors.ghost, label: 'OFF DUTY',  icon: '\u2014' },
};

interface AgentCardProps {
  agent: Agent;
  index: number;
  width: number;
  currentTask?: Task;
  runDuration?: string;
  isLeader: boolean;
}

function AgentCard({ agent, index, width, currentTask, runDuration, isLeader }: AgentCardProps) {
  const accent = getAgentAccent(index);
  const rank = getRank(agent.stats.tasks_completed);
  const xp = getXpProgress(agent.stats.tasks_completed);
  const streak = getStreak(agent);
  const earnedBadges = ACHIEVEMENTS.filter((a) => a.test(agent));
  const successRate = calcSuccessRate(agent);
  const style = STATUS_STYLE[agent.status] ?? STATUS_STYLE['idle']!;

  const cardW = Math.max(30, width);
  const innerW = cardW - 4; // padding 2 each side

  // Card border characters
  const TL = '\u250C'; // ┌
  const TR = '\u2510'; // ┐
  const BL = '\u2514'; // └
  const BR = '\u2518'; // ┘
  const V = '\u2502';  // │
  const H = '\u2500';  // ─

  const borderColor = agent.status === 'running' ? accent : tuiColors.ghost;

  const topBorder = `${TL}${H.repeat(cardW - 2)}${TR}`;
  const bottomBorder = `${BL}${H.repeat(cardW - 2)}${BR}`;

  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Text color={borderColor}>{topBorder}</Text>

      {/* Row 1: Name + Rank badge */}
      <Box>
        <Text color={borderColor}>{V} </Text>
        <Box width={innerW} justifyContent="space-between">
          <Box>
            {isLeader && <Text color="#ffd700">{'\u265A'} </Text>}
            <Text color={accent} bold>{agent.name}</Text>
            <Text color={tuiColors.ghost}> {DOT} </Text>
            <Text color={tuiColors.dim}>{agent.adapter}</Text>
          </Box>
          <Box>
            <Text backgroundColor={style.bg} color={style.fg}>
              {' '}{style.icon} {style.label}{' '}
            </Text>
          </Box>
        </Box>
        <Text color={borderColor}> {V}</Text>
      </Box>

      {/* Row 2: Role + rank */}
      <Box>
        <Text color={borderColor}>{V} </Text>
        <Box width={innerW}>
          <Text color={tuiColors.dim}>{rank.icon} </Text>
          <Text color={tuiColors.silver}>{rank.title}</Text>
          {agent.role && (
            <>
              <Text color={tuiColors.ghost}> {DOT} </Text>
              <Text color={tuiColors.dim}>{agent.role.length > innerW - 20 ? agent.role.slice(0, innerW - 23) + '...' : agent.role}</Text>
            </>
          )}
        </Box>
        <Text color={borderColor}> {V}</Text>
      </Box>

      {/* Row 3: XP Bar */}
      <Box>
        <Text color={borderColor}>{V} </Text>
        <Box width={innerW}>
          <Text color={tuiColors.dim}>XP </Text>
          <ProgressBar pct={xp.pct} width={Math.max(6, innerW - 18)} color={accent} />
          <Text color={tuiColors.dim}> {xp.current}/{xp.needed}</Text>
        </Box>
        <Text color={borderColor}> {V}</Text>
      </Box>

      {/* Row 4: Stats line */}
      <Box>
        <Text color={borderColor}>{V} </Text>
        <Box width={innerW}>
          <Text color={tuiColors.green}>{'\u2713'}{agent.stats.tasks_completed}</Text>
          <Text color={tuiColors.ghost}> </Text>
          <Text color={tuiColors.red}>{'\u2715'}{agent.stats.tasks_failed}</Text>
          <Text color={tuiColors.ghost}> </Text>
          <Text color={tuiColors.cyan}>{successRate}%</Text>
          {streak > 0 && (
            <>
              <Text color={tuiColors.ghost}> {DOT} </Text>
              <Text color={streak >= 5 ? tuiColors.amber : streak >= 3 ? tuiColors.yellow : tuiColors.dim}>
                {'\u26A1'}{streak}
              </Text>
            </>
          )}
          {agent.stats.tokens_used != null && agent.stats.tokens_used > 0 && (
            <>
              <Text color={tuiColors.ghost}> {DOT} </Text>
              <Text color={tuiColors.dim}>
                {formatTokens(agent.stats.tokens_used)} tok
              </Text>
            </>
          )}
        </Box>
        <Text color={borderColor}> {V}</Text>
      </Box>

      {/* Row 5: Current activity */}
      <Box>
        <Text color={borderColor}>{V} </Text>
        <Box width={innerW}>
          {agent.status === 'running' && currentTask ? (
            <>
              <TypingIndicator color={accent} />
              <Text color={tuiColors.silver}> {currentTask.title.length > innerW - 10 ? currentTask.title.slice(0, innerW - 13) + '...' : currentTask.title}</Text>
            </>
          ) : agent.status === 'running' ? (
            <>
              <TypingIndicator color={accent} />
              <Text color={tuiColors.dim}> processing...</Text>
            </>
          ) : agent.status === 'error' ? (
            <>
              <ErrorIndicator />
              <Text color={tuiColors.red}> needs attention</Text>
            </>
          ) : agent.status === 'disabled' ? (
            <Text color={tuiColors.ghost}>{'\u2014'} out of office</Text>
          ) : (
            <>
              <IdleIndicator />
              <Text color={tuiColors.dim}> awaiting assignment</Text>
            </>
          )}
        </Box>
        <Text color={borderColor}> {V}</Text>
      </Box>

      {/* Row 6: Badges */}
      {earnedBadges.length > 0 && (
        <Box>
          <Text color={borderColor}>{V} </Text>
          <Box width={innerW}>
            {earnedBadges.slice(0, Math.floor(innerW / 4)).map((badge) => (
              <Text key={badge.id} color={badge.color}>{badge.icon} </Text>
            ))}
          </Box>
          <Text color={borderColor}> {V}</Text>
        </Box>
      )}

      {/* Row 7: Runtime if running */}
      {agent.status === 'running' && runDuration && (
        <Box>
          <Text color={borderColor}>{V} </Text>
          <Box width={innerW}>
            <Text color={tuiColors.dim}>{'\u23F1'} {runDuration}</Text>
          </Box>
          <Text color={borderColor}> {V}</Text>
        </Box>
      )}

      {/* Bottom border */}
      <Text color={borderColor}>{bottomBorder}</Text>
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════
   LEADERBOARD
   ══════════════════════════════════════════════════════════ */

function Leaderboard({ agents, width }: { agents: Agent[]; width: number }) {
  // Build index map once to avoid O(N²) indexOf calls
  const indexMap = new Map(agents.map((a, i) => [a.id, i]));

  const sorted = [...agents]
    .filter((a) => a.status !== 'disabled')
    .sort((a, b) => {
      if (b.stats.tasks_completed !== a.stats.tasks_completed)
        return b.stats.tasks_completed - a.stats.tasks_completed;
      return calcSuccessRate(b) - calcSuccessRate(a);
    });

  if (sorted.length === 0) return null;

  const medals = ['\u265A', '\u265B', '\u265C']; // ♚ ♛ ♜
  const medalColors = ['#ffd700', '#c0c0c0', '#cd7f32']; // gold, silver, bronze

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={tuiColors.amber} bold>{'\u2655'} LEADERBOARD</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(Math.min(width - 2, 40))}</Text>
      </Box>
      {sorted.map((agent, i) => {
        const rank = getRank(agent.stats.tasks_completed);
        const accent = getAgentAccent(indexMap.get(agent.id) ?? 0);
        return (
          <Box key={agent.id} paddingX={1} gap={1}>
            <Text color={i < 3 ? medalColors[i] : tuiColors.dim} bold={i < 3}>
              {i < 3 ? medals[i] : `${i + 1}.`}
            </Text>
            <Text color={accent} bold={i === 0}>{agent.name}</Text>
            <Text color={tuiColors.dim}>{rank.icon} {rank.title}</Text>
            <Text color={tuiColors.green}>{'\u2713'}{agent.stats.tasks_completed}</Text>
            <Text color={tuiColors.cyan}>{calcSuccessRate(agent)}%</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════
   OFFICE STATS SUMMARY
   ══════════════════════════════════════════════════════════ */

function OfficeSummary({ agents, state, width }: {
  agents: Agent[]; state: OrchestratorState; width: number;
}) {
  // Single pass over agents instead of 6 separate iterations
  const summary = agents.reduce(
    (acc, a) => {
      if (a.status === 'running') acc.working++;
      else if (a.status === 'idle') acc.available++;
      else if (a.status === 'error') acc.onError++;
      else if (a.status === 'disabled') acc.offDuty++;
      acc.completed += a.stats.tasks_completed;
      acc.failed += a.stats.tasks_failed;
      return acc;
    },
    { working: 0, available: 0, onError: 0, offDuty: 0, completed: 0, failed: 0 },
  );
  const { working, available, onError, offDuty, completed: totalCompleted, failed: totalFailed } = summary;
  const total = agents.length;

  const teamSuccessRate = (totalCompleted + totalFailed) > 0
    ? Math.round((totalCompleted / (totalCompleted + totalFailed)) * 100)
    : 0;

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={tuiColors.amber} bold>{'\u2302'} OFFICE STATUS</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(Math.min(width - 2, 40))}</Text>
      </Box>
      <Box paddingX={1} gap={2}>
        <Text color={tuiColors.green}>{'\u25CF'} {working} working</Text>
        <Text color={tuiColors.dim}>{'\u25CB'} {available} available</Text>
        {onError > 0 && <Text color={tuiColors.red}>{'\u2715'} {onError} error</Text>}
        {offDuty > 0 && <Text color={tuiColors.ghost}>{'\u2014'} {offDuty} off duty</Text>}
      </Box>
      <Box paddingX={1} gap={2}>
        <Text color={tuiColors.silver}>Team: {total} agents</Text>
        <Text color={tuiColors.dim}>{DOT}</Text>
        <Text color={tuiColors.green}>{'\u2713'}{totalCompleted} done</Text>
        <Text color={tuiColors.dim}>{DOT}</Text>
        <Text color={tuiColors.cyan}>Team rate: {teamSuccessRate}%</Text>
        <Text color={tuiColors.dim}>{DOT}</Text>
        <Text color={tuiColors.dim}>Runs: {state.stats.total_runs}</Text>
      </Box>
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN EXPORT: OfficeView
   ══════════════════════════════════════════════════════════ */

export interface OfficeViewProps {
  agents: Agent[];
  tasks: Task[];
  state: OrchestratorState;
  height: number;
  width: number;
}

export function OfficeView({ agents, tasks, state, height, width }: OfficeViewProps) {
  // Build lookup maps
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Find leader (most completed tasks among non-disabled)
  const activeAgents = agents.filter((a) => a.status !== 'disabled');
  const leaderId = activeAgents.length > 0
    ? activeAgents.reduce((best, a) =>
        a.stats.tasks_completed > best.stats.tasks_completed ? a : best
      ).id
    : null;

  // Card width calculation: fit 2 cards side-by-side if terminal is wide enough
  const minCardWidth = 38;
  const maxCardWidth = 56;
  const gapBetweenCards = 2;
  const availableW = width - 4; // padding
  const cardsPerRow = availableW >= (minCardWidth * 2 + gapBetweenCards) ? 2 : 1;
  const cardW = cardsPerRow === 2
    ? Math.min(maxCardWidth, Math.floor((availableW - gapBetweenCards) / 2))
    : Math.min(maxCardWidth, availableW);

  // Split agents into rows
  const agentRows: Agent[][] = [];
  for (let i = 0; i < agents.length; i += cardsPerRow) {
    agentRows.push(agents.slice(i, i + cardsPerRow));
  }

  // Calculate run durations
  const runDurations = new Map<string, string>();
  for (const [, entry] of Object.entries(state.running)) {
    const elapsed = Date.now() - new Date(entry.started_at).getTime();
    runDurations.set(entry.agent_id, formatDuration(elapsed));
  }

  // Layout: cards area + sidebar (leaderboard + summary)
  const showSidebar = width >= 90 && agents.length > 1;
  const sidebarW = showSidebar ? Math.min(36, Math.floor(width * 0.3)) : 0;
  const cardsAreaW = width - sidebarW;

  if (agents.length === 0) {
    return (
      <Box flexDirection="column" height={height} paddingX={1} justifyContent="center" alignItems="center">
        <Text color={tuiColors.ghost}>{'\u2302'}</Text>
        <Box height={1} />
        <Text color={tuiColors.dim}>The office is empty</Text>
        <Text color={tuiColors.ghost}>Add agents with <Text color={tuiColors.amber}>N</Text> or <Text color={tuiColors.amber}>/agent add</Text></Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" height={height}>
      {/* Cards area */}
      <Box flexDirection="column" width={cardsAreaW}>
        {agentRows.map((row, ri) => (
          <Box key={ri} gap={gapBetweenCards} paddingX={1}>
            {row.map((agent, ci) => {
              const globalIdx = ri * cardsPerRow + ci;
              const currentTask = agent.current_task ? taskMap.get(agent.current_task) : undefined;
              return (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  index={globalIdx}
                  width={cardW}
                  currentTask={currentTask}
                  runDuration={runDurations.get(agent.id)}
                  isLeader={agent.id === leaderId}
                />
              );
            })}
          </Box>
        ))}
      </Box>

      {/* Sidebar: Leaderboard + Office Summary */}
      {showSidebar && (
        <Box flexDirection="column" width={sidebarW} borderStyle="single" borderColor={tuiColors.ghost}>
          <Leaderboard agents={agents} width={sidebarW} />
          <Box height={1} />
          <OfficeSummary agents={agents} state={state} width={sidebarW} />
        </Box>
      )}
    </Box>
  );
}
