/**
 * Inline search bar for Logs view.
 *
 * Renders at the bottom of LogsContent when search is active.
 * Supports regex input with match counter and invalid regex feedback.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { tuiColors } from '../colors.js';

export interface LogsSearchBarProps {
  query: string;
  matchCount: number;
  currentMatch: number; // 0-based index of current highlighted match (-1 = none)
  isInvalid: boolean;
  width: number;
}

export const LogsSearchBar = React.memo(function LogsSearchBar({
  query,
  matchCount,
  currentMatch,
  isInvalid,
  width,
}: LogsSearchBarProps) {
  const counterText = isInvalid
    ? 'Invalid regex'
    : matchCount > 0
      ? `${currentMatch + 1}/${matchCount}`
      : query.length > 0
        ? 'No matches'
        : '';

  const counterColor = isInvalid
    ? tuiColors.red
    : matchCount > 0
      ? tuiColors.amber
      : tuiColors.dim;

  // Available width for query display
  const labelW = 3; // "/ "  + cursor space
  const counterW = counterText.length + 2; // space + counter + space
  const maxQueryW = Math.max(5, width - labelW - counterW - 4);
  const displayQuery = query.length > maxQueryW ? query.slice(-maxQueryW) : query;

  return (
    <Box paddingX={1}>
      <Text color={tuiColors.amber} bold>{'/'}</Text>
      <Text color={tuiColors.white}>{displayQuery}</Text>
      <Text color={tuiColors.amber}>{'▏'}</Text>
      {counterText && (
        <>
          <Text color={tuiColors.ghost}>{' '}</Text>
          <Text color={counterColor}>{counterText}</Text>
        </>
      )}
      <Text color={tuiColors.ghost}>{' '}</Text>
      <Text color={tuiColors.dim}>{'n/N next/prev · Esc close'}</Text>
    </Box>
  );
});
