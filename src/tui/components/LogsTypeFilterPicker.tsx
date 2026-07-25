/**
 * Multi-select popup for filtering log messages by type.
 *
 * Displays 8 message types with icons, names, and message counts.
 * Quick presets at bottom: 1=all, 2=text, 3=tools, 4=errors, 5=events.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { tuiColors, LIGHT_RULE, DOT } from '../colors.js';

type MsgType = 'system' | 'lifecycle' | 'output' | 'tool' | 'result' | 'error' | 'file' | 'info';

const TYPE_ICONS: Record<MsgType, string> = {
  system: '\u2666',    // ◆
  lifecycle: '\u25B6',  // ▶
  output: '\u2502',     // │
  tool: '\u2699',       // ⚙
  result: '\u2190',     // ←
  error: '\u2715',      // ✕
  file: '\u270E',       // ✎
  info: '\u2502',       // │
};

const TYPE_LABELS: Record<MsgType, string> = {
  system: 'System',
  lifecycle: 'Lifecycle',
  output: 'Output',
  tool: 'Tool calls',
  result: 'Results',
  error: 'Errors',
  file: 'Files',
  info: 'Info',
};

const TYPE_COLOR_KEYS: Record<MsgType, keyof typeof tuiColors> = {
  system: 'purple',
  lifecycle: 'cyan',
  output: 'white',
  tool: 'blue',
  result: 'green',
  error: 'red',
  file: 'purple',
  info: 'silver',
};

const ALL_TYPES: MsgType[] = ['system', 'lifecycle', 'output', 'tool', 'result', 'error', 'file', 'info'];

const PRESETS: ReadonlyArray<{ key: string; label: string; types: MsgType[] }> = [
  { key: '1', label: 'all', types: ALL_TYPES },
  { key: '2', label: 'text', types: ['output'] },
  { key: '3', label: 'tools', types: ['tool', 'result', 'file'] },
  { key: '4', label: 'errors', types: ['error'] },
  { key: '5', label: 'events', types: ['lifecycle', 'system'] },
];

export interface LogsTypeFilterPickerProps {
  /** Current selected types. */
  selected: ReadonlySet<string>;
  /** Message count per type. */
  typeCounts: Readonly<Record<string, number>>;
  onConfirm: (selected: Set<string>) => void;
  onCancel: () => void;
}

const LogsTypeFilterPicker = React.memo(function LogsTypeFilterPicker({
  selected,
  typeCounts,
  onConfirm,
  onCancel,
}: LogsTypeFilterPickerProps) {
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<Set<MsgType>>(() => new Set(selected as Set<MsgType>));

  const allSelected = useMemo(
    () => draft.size === ALL_TYPES.length || ALL_TYPES.every((t) => draft.has(t)),
    [draft],
  );

  useInput((input, key) => {
    // Navigate
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : ALL_TYPES.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < ALL_TYPES.length - 1 ? c + 1 : 0));
      return;
    }

    // Space: toggle current type
    if (input === ' ') {
      const type = ALL_TYPES[cursor];
      if (!type) return;
      setDraft((prev) => {
        const next = new Set(prev);
        if (next.has(type)) {
          next.delete(type);
        } else {
          next.add(type);
        }
        return next;
      });
      return;
    }

    // 'a': select all / deselect all toggle
    if (input === 'a' || input === 'A') {
      setDraft((prev) => {
        if (prev.size === ALL_TYPES.length) {
          return new Set<MsgType>();
        }
        return new Set<MsgType>(ALL_TYPES);
      });
      return;
    }

    // Quick presets: 1-5
    for (const preset of PRESETS) {
      if (input === preset.key) {
        setDraft(new Set<MsgType>(preset.types));
        return;
      }
    }

    // Enter: confirm
    if (key.return) {
      // Empty = all types (normalize)
      const result = draft.size === 0 ? new Set<string>(ALL_TYPES) : new Set<string>(draft);
      onConfirm(result);
      return;
    }

    // Escape: cancel
    if (key.escape) {
      onCancel();
      return;
    }
  });

  const totalSelected = allSelected ? ALL_TYPES.length : draft.size;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tuiColors.amber} paddingX={1}>
      {/* Header */}
      <Box gap={1}>
        <Text color={tuiColors.amber} bold>{' \u25C8 Type Filter'}</Text>
        <Text color={tuiColors.dim}>{DOT} {totalSelected}/{ALL_TYPES.length} selected</Text>
      </Box>
      <Text color={tuiColors.ghost}>{LIGHT_RULE.repeat(36)}</Text>

      {/* Type list */}
      {ALL_TYPES.map((type, idx) => {
        const isCursor = idx === cursor;
        const isChecked = draft.has(type);
        const count = typeCounts[type] ?? 0;
        const typeColor = tuiColors[TYPE_COLOR_KEYS[type]];

        return (
          <Box key={type} gap={0}>
            <Text color={isCursor ? tuiColors.amber : tuiColors.ghost}>
              {isCursor ? ' \u25B8 ' : '   '}
            </Text>
            <Text color={isChecked ? tuiColors.green : tuiColors.ghost}>
              {isChecked ? '[\u2713]' : '[ ]'}
            </Text>
            <Text color={isCursor ? typeColor : tuiColors.dim}>
              {' '}{TYPE_ICONS[type]}{' '}
            </Text>
            <Text color={isCursor ? typeColor : (isChecked ? tuiColors.silver : tuiColors.dim)} bold={isCursor}>
              {TYPE_LABELS[type]}
            </Text>
            {count > 0 && (
              <Text color={tuiColors.dim}> {DOT}{count}</Text>
            )}
          </Box>
        );
      })}

      {/* Presets */}
      <Text color={tuiColors.ghost}>{LIGHT_RULE.repeat(36)}</Text>
      <Box gap={0}>
        <Text color={tuiColors.dim}>{' '}</Text>
        {PRESETS.map((p, i) => (
          <React.Fragment key={p.key}>
            {i > 0 && <Text color={tuiColors.ghost}> {DOT} </Text>}
            <Text color={tuiColors.amberDim}>{p.key}</Text>
            <Text color={tuiColors.dim}>{'='}{p.label}</Text>
          </React.Fragment>
        ))}
      </Box>

      {/* Footer */}
      <Text color={tuiColors.dim}>
        {' Space toggle'} {DOT} {'a all'} {DOT} {'Enter confirm'} {DOT} {'Esc cancel'}
      </Text>
    </Box>
  );
});

export { LogsTypeFilterPicker };
