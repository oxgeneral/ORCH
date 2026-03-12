/**
 * TUI TabBar — combined status line + view switcher in one row.
 *
 * Layout:
 *   ◆ orch · project          T TASKS  A agents  L logs       watching · 1 running
 */

import React from 'react';
import { Box, Text } from 'ink';
import { tuiColors, DOT } from '../colors.js';

export type ViewId = 'goals' | 'tasks' | 'agents' | 'logs';

const DIAMOND = '\u25C6'; // ◆

const TABS: Array<{ key: string; id: ViewId; label: string }> = [
  { key: 'G', id: 'goals', label: 'GOALS' },
  { key: 'T', id: 'tasks', label: 'TASKS' },
  { key: 'A', id: 'agents', label: 'AGENTS' },
  { key: 'L', id: 'logs', label: 'ACTIONS' },
];

export interface TabBarProps {
  activeView: ViewId;
  projectName: string;
  mode: string;
  runningCount: number;
  uptime?: string;
  width: number;
}

export function TabBar({ activeView, projectName, mode, runningCount, uptime, width }: TabBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between" width={width}>
      {/* Left: project name */}
      <Box>
        <Text color={tuiColors.amber}>{DIAMOND}</Text>
        <Text color={tuiColors.amber} bold> orch</Text>
        <Text color={tuiColors.ghost}> {DOT} </Text>
        <Text color={tuiColors.white}>{projectName}</Text>
      </Box>

      {/* Center: tabs */}
      <Box>
        {TABS.map((tab, i) => {
          const isActive = activeView === tab.id;
          return (
            <React.Fragment key={tab.id}>
              {i > 0 && <Text color={tuiColors.ghost}>{'  '}</Text>}
              <Text
                color={isActive ? tuiColors.amber : tuiColors.dim}
                bold={isActive}
              >
                {tab.key}
              </Text>
              <Text
                color={isActive ? tuiColors.amber : tuiColors.dim}
                bold={isActive}
              >
                {' '}{isActive ? tab.label : tab.label.toLowerCase()}
              </Text>
            </React.Fragment>
          );
        })}
      </Box>

      {/* Right: status */}
      <Box>
        <Text
          color={mode === 'watching' ? tuiColors.green : undefined}
          dimColor={mode === 'idle'}
        >
          {mode}
        </Text>
        {runningCount > 0 && (
          <>
            <Text color={tuiColors.ghost}> {DOT} </Text>
            <Text color={tuiColors.green} bold>{runningCount} running</Text>
          </>
        )}
        {uptime && (
          <>
            <Text color={tuiColors.ghost}> {DOT} </Text>
            <Text color={tuiColors.dim}>{uptime}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

export { TABS };
