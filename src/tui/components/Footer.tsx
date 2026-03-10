/**
 * TUI Footer — hotkey hints.
 *
 * Single line at the bottom of the screen.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { formatTokens } from '../../cli/output.js';

export interface FooterProps {
  totalTokens?: number;
  taskCount?: number;
}

export function Footer({ totalTokens, taskCount }: FooterProps) {
  return (
    <Box paddingX={1} gap={2}>
      <Text dimColor>
        <Text bold>Q</Text> quit
      </Text>
      {taskCount !== undefined && taskCount > 0 && (
        <Text dimColor>{taskCount} tasks</Text>
      )}
      {totalTokens !== undefined && totalTokens > 0 && (
        <Text dimColor>{formatTokens(totalTokens)} tokens</Text>
      )}
    </Box>
  );
}
