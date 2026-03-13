/**
 * TUI CommandBar — persistent input line at the bottom of the screen.
 *
 * Navigate mode: hotkey hints (↑↓ nav, Tab tabs, / cmd, Q quit)
 * Command mode: / prompt with typed text, ghost completion, cursor + suggestion hints
 */

import React from 'react';
import { Box, Text } from 'ink';
import { tuiColors } from '../colors.js';
import type { ViewId } from './TabBar.js';

const CURSOR_CHAR = '\u2588'; // █

export interface CommandBarProps {
  mode: 'navigate' | 'command';
  value: string;
  completion: string | null;
  activeView: ViewId;
  canRun: boolean;
  canNew: boolean;
  canApprove?: boolean;
  canReject?: boolean;
  canCancel?: boolean;
  canDelete?: boolean;
  canUndo?: boolean;
  canEdit?: boolean;
  canForceStop?: boolean;
  canToggleAuto?: boolean;
  autoActive?: boolean;
  canPause?: boolean;
  isPaused?: boolean;
  canToggleShowAll?: boolean;
  showAllActive?: boolean;
  hasDetail: boolean;
  itemCount: number;
  itemLabel: string;
  width: number;
  hasSuggestions?: boolean;
  onboardingCompleted?: boolean;
}

export const CommandBar = React.memo(function CommandBar({
  mode, value, completion, activeView, canRun, canNew, canApprove, canReject, canCancel, canDelete, canUndo, canEdit, canForceStop, canToggleAuto, autoActive, canPause, isPaused, canToggleShowAll, showAllActive, hasDetail,
  itemCount, itemLabel, width, hasSuggestions, onboardingCompleted,
}: CommandBarProps) {
  if (mode === 'command') {
    const hintText = hasSuggestions
      ? '  \u2191\u2193 select  Tab fill  Esc \u2715'
      : '  Enter exec  \u2191\u2193 history  Tab complete  Esc \u2715';
    const maxLen = Math.max(4, width - 6 - hintText.length - (completion?.length ?? 0) - 1);
    const display = value.length > maxLen ? '\u2026' + value.slice(-(maxLen - 1)) : value;

    return (
      <Box paddingX={2} justifyContent="space-between" width={width}>
        <Box>
          <Text color={tuiColors.amber}>/ </Text>
          <Text color={tuiColors.white}>{display}</Text>
          {completion && <Text color={tuiColors.ghost}>{completion}</Text>}
          <Text color={tuiColors.amber}>{CURSOR_CHAR}</Text>
          <Text color={tuiColors.dim}>{hintText}</Text>
        </Box>
      </Box>
    );
  }

  // Navigate mode — hotkey hints
  return (
    <Box paddingX={2} justifyContent="space-between" width={width}>
      <Text color={tuiColors.dim}>
        <Text bold color={tuiColors.gray}>{'\u2191\u2193'}</Text>
        {'  '}
        <Text bold color={tuiColors.gray}>Tab</Text>
        {'/'}
        <Text bold color={tuiColors.gray}>{'\u2190\u2192'}</Text>
        {'  '}
        <Text bold color={tuiColors.gray}>/</Text>
        {' cmd'}
        {canNew && (
          <>
            {'  '}
            <Text bold color={tuiColors.gray}>N</Text>
            {' new'}
          </>
        )}
        {canRun && (
          <>
            {'  '}
            <Text bold color={tuiColors.gray}>R</Text>
            {' run'}
          </>
        )}
        {canCancel && (
          <>
            {'  '}
            <Text bold color={tuiColors.amber}>C</Text>
            {' cancel'}
          </>
        )}
        {canApprove && (
          <>
            {'  '}
            <Text bold color={tuiColors.green}>A</Text>
            {' approve'}
          </>
        )}
        {canReject && (
          <>
            {'  '}
            <Text bold color={tuiColors.red}>X</Text>
            {' reject'}
          </>
        )}
        {canEdit && (
          <>
            {'  '}
            <Text bold color={tuiColors.cyan}>E</Text>
            {' edit'}
          </>
        )}
        {canForceStop && (
          <>
            {'  '}
            <Text bold color={tuiColors.red}>S</Text>
            {' stop'}
          </>
        )}
        {canPause && (
          <>
            {'  '}
            <Text bold color={tuiColors.amber}>P</Text>
            {isPaused ? ' resume' : ' pause'}
          </>
        )}
        {canToggleAuto && (
          <>
            {'  '}
            <Text bold color={tuiColors.cyan}>U</Text>
            {autoActive ? ' auto off' : ' auto on'}
          </>
        )}
        {canToggleShowAll && (
          <>
            {'  '}
            <Text bold color={tuiColors.gray}>S</Text>
            {showAllActive ? ' collapse' : ' show all'}
          </>
        )}
        {canDelete && !canApprove && (
          <>
            {'  '}
            <Text bold color={tuiColors.gray}>D</Text>
            {' delete'}
          </>
        )}
        {canUndo && (
          <>
            {'  '}
            <Text bold color={tuiColors.yellow}>Z</Text>
            {' undo'}
          </>
        )}
        {hasDetail && (
          <>
            {'  '}
            <Text bold color={tuiColors.gray}>Esc</Text>
            {' close'}
          </>
        )}
        {!hasDetail && (activeView === 'tasks' || activeView === 'agents' || activeView === 'goals') && (
          <>
            {'  '}
            <Text bold color={tuiColors.gray}>Enter</Text>
            {' detail'}
          </>
        )}
        {'  '}
        <Text bold color={tuiColors.gray}>Q</Text>
        {' quit'}
        {'  '}
        <Text bold color={onboardingCompleted === false ? tuiColors.amber : tuiColors.gray}>?</Text>
        <Text color={onboardingCompleted === false ? tuiColors.amber : undefined}>{' help'}</Text>
      </Text>
      {itemCount > 0 && <Text color={tuiColors.dim}>{itemCount} {itemLabel}</Text>}
    </Box>
  );
});
