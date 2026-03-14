import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { tuiColors, LIGHT_RULE, DOT } from '../colors.js';

export interface LogsFilterPickerProps {
  agents: ReadonlyArray<{ id: string; name: string }>;
  /** Current selected agent IDs (empty = all). */
  selected: ReadonlySet<string>;
  /** Message count per agentId. */
  msgCounts: ReadonlyMap<string, number>;
  /** Agent color per agentId. */
  colorMap: ReadonlyMap<string, string>;
  /** Max visible rows (viewport height). */
  maxHeight: number;
  onConfirm: (selected: Set<string>) => void;
  onCancel: () => void;
}

const LogsFilterPicker = React.memo(function LogsFilterPicker({
  agents,
  selected,
  msgCounts,
  colorMap,
  maxHeight,
  onConfirm,
  onCancel,
}: LogsFilterPickerProps) {
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected));

  const allSelected = useMemo(() => draft.size === 0 || draft.size === agents.length, [draft.size, agents.length]);

  // Visible window for scrolling
  const listH = Math.max(3, maxHeight - 5); // header(2) + footer(2) + divider(1)
  const scrollOffset = useMemo(() => {
    if (agents.length <= listH) return 0;
    const half = Math.floor(listH / 2);
    const maxOff = agents.length - listH;
    return Math.min(maxOff, Math.max(0, cursor - half));
  }, [cursor, agents.length, listH]);

  const visibleAgents = agents.slice(scrollOffset, scrollOffset + listH);

  useInput((input, key) => {
    // Navigate
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : agents.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < agents.length - 1 ? c + 1 : 0));
      return;
    }

    // Space: toggle current agent
    if (input === ' ') {
      const agent = agents[cursor];
      if (!agent) return;
      setDraft((prev) => {
        const next = new Set(prev);
        if (next.has(agent.id)) {
          next.delete(agent.id);
        } else {
          next.add(agent.id);
        }
        return next;
      });
      return;
    }

    // 'a': select all / deselect all toggle
    if (input === 'a' || input === 'A') {
      setDraft((prev) => {
        if (prev.size === 0 || prev.size === agents.length) {
          // Currently all selected → deselect all (empty = show all, so this deselects to none)
          // Actually: empty Set = all agents shown. To "deselect all" we need all IDs in set? No:
          // Per spec: empty Set = all agents (no filter). So toggle:
          // If currently "all" (size=0 or size=agents.length) → select none (impossible to show nothing, so skip)
          // Better: if all are checked → uncheck all, if some/none checked → check all
          return new Set<string>();
        }
        return new Set<string>();
      });
      return;
    }

    // Enter: confirm
    if (key.return) {
      onConfirm(new Set(draft));
      return;
    }

    // Escape: cancel
    if (key.escape) {
      onCancel();
      return;
    }
  });

  const totalSelected = draft.size === 0 ? agents.length : draft.size;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tuiColors.amber} paddingX={1}>
      {/* Header */}
      <Box gap={1}>
        <Text color={tuiColors.amber} bold>{' \u25C8 Agent Filter'}</Text>
        <Text color={tuiColors.dim}>{DOT} {totalSelected}/{agents.length} selected</Text>
      </Box>
      <Text color={tuiColors.ghost}>{LIGHT_RULE.repeat(36)}</Text>

      {/* Agent list */}
      {visibleAgents.map((agent, vi) => {
        const realIdx = vi + scrollOffset;
        const isCursor = realIdx === cursor;
        const isChecked = draft.size === 0 || draft.has(agent.id);
        const ac = colorMap.get(agent.id) ?? tuiColors.silver;
        const count = msgCounts.get(agent.id) ?? 0;

        return (
          <Box key={agent.id} gap={0}>
            <Text color={isCursor ? tuiColors.amber : tuiColors.ghost}>
              {isCursor ? ' \u25B8 ' : '   '}
            </Text>
            <Text color={isChecked ? tuiColors.green : tuiColors.ghost}>
              {isChecked ? '[\u2713]' : '[ ]'}
            </Text>
            <Text color={isCursor ? ac : (isChecked ? tuiColors.silver : tuiColors.dim)} bold={isCursor}>
              {' '}{agent.name}
            </Text>
            {count > 0 && (
              <Text color={tuiColors.dim}> {DOT}{count}</Text>
            )}
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {agents.length > listH && (
        <Text color={tuiColors.ghost}>
          {'   '}{scrollOffset > 0 ? '\u2191' : ' '}{' '}{scrollOffset + listH < agents.length ? '\u2193' : ' '}
          {' '}{cursor + 1}/{agents.length}
        </Text>
      )}

      {/* Footer */}
      <Text color={tuiColors.ghost}>{LIGHT_RULE.repeat(36)}</Text>
      <Text color={tuiColors.dim}>
        {' Space toggle'} {DOT} {'a all'} {DOT} {'Enter confirm'} {DOT} {'Esc cancel'}
      </Text>
    </Box>
  );
});

export { LogsFilterPicker };
