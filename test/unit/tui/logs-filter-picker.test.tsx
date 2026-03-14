/**
 * LogsFilterPicker tests.
 *
 * Tests multi-select popup for agent log filtering:
 * navigation, toggle, select-all, confirm/cancel.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { LogsFilterPicker } from '../../../src/tui/components/LogsFilterPicker.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const agents = [
  { id: 'a1', name: 'Backend A' },
  { id: 'a2', name: 'QA' },
  { id: 'a3', name: 'Reviewer' },
];

function setup(overrides?: { selected?: Set<string> }) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const selected = overrides?.selected ?? new Set<string>();
  const msgCounts = new Map([['a1', 10], ['a2', 5]]);
  const colorMap = new Map([['a1', '#ff0000'], ['a2', '#00ff00']]);

  const { lastFrame, stdin } = render(
    <LogsFilterPicker
      agents={agents}
      selected={selected}
      msgCounts={msgCounts}
      colorMap={colorMap}
      maxHeight={20}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { lastFrame, stdin, onConfirm, onCancel };
}

describe('LogsFilterPicker', () => {
  it('renders header with Agent Filter title', () => {
    const { lastFrame } = setup();
    expect(lastFrame()).toContain('Agent Filter');
  });

  it('shows all agent names', () => {
    const { lastFrame } = setup();
    const frame = lastFrame()!;
    expect(frame).toContain('Backend A');
    expect(frame).toContain('QA');
    expect(frame).toContain('Reviewer');
  });

  it('shows 3/3 selected when no filter (empty set = all)', () => {
    const { lastFrame } = setup({ selected: new Set() });
    expect(lastFrame()).toContain('3/3 selected');
  });

  it('shows 1/3 selected when one agent selected', () => {
    const { lastFrame } = setup({ selected: new Set(['a1']) });
    expect(lastFrame()).toContain('1/3 selected');
  });

  it('shows message counts for agents with messages', () => {
    const { lastFrame } = setup();
    const frame = lastFrame()!;
    expect(frame).toContain('·10'); // a1 has 10 messages
    expect(frame).toContain('·5');  // a2 has 5 messages
  });

  it('shows footer with controls hint', () => {
    const { lastFrame } = setup();
    const frame = lastFrame()!;
    expect(frame).toContain('Space toggle');
    expect(frame).toContain('Enter confirm');
    expect(frame).toContain('Esc cancel');
  });

  it('Space toggles agent on', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set() });
    // Cursor at index 0 (Backend A). Since empty set = all shown, Space adds explicit a1.
    stdin.write(' ');
    await delay(50);
    const frame = lastFrame()!;
    // After toggling from "all shown" (size=0), a1 gets added explicitly
    expect(frame).toContain('1/3 selected');
  });

  it('Space toggles agent off when it was selected', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(['a1', 'a2', 'a3']) });
    // Cursor at index 0 (Backend A). Space deselects it.
    stdin.write(' ');
    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain('2/3 selected');
  });

  it('down arrow moves cursor to next agent', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(['a1', 'a2', 'a3']) });
    // Move down to QA (index 1), then Space deselects QA
    stdin.write('\x1B[B'); // down
    await delay(50);
    stdin.write(' '); // toggle QA off
    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain('2/3 selected');
  });

  it('up arrow wraps from first to last agent', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(['a1', 'a2', 'a3']) });
    // Up from index 0 should wrap to last (Reviewer, index 2)
    stdin.write('\x1B[A'); // up
    await delay(50);
    stdin.write(' '); // toggle Reviewer off
    await delay(50);
    expect(lastFrame()).toContain('2/3 selected');
  });

  it('Enter confirms with current selection', async () => {
    const { stdin, onConfirm } = setup({ selected: new Set(['a1']) });
    stdin.write('\r');
    await delay(50);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0] as Set<string>;
    expect(result.has('a1')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('Escape cancels without calling onConfirm', async () => {
    const { stdin, onConfirm, onCancel } = setup();
    stdin.write('\x1B');
    await delay(50);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('down arrow wraps from last to first agent', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(['a1', 'a2', 'a3']) });
    // Move down 3 times to wrap back to first
    stdin.write('\x1B[B'); // down to index 1
    await delay(50);
    stdin.write('\x1B[B'); // down to index 2
    await delay(50);
    stdin.write('\x1B[B'); // down wraps to index 0 (Backend A)
    await delay(50);
    stdin.write(' '); // toggle Backend A off
    await delay(50);
    expect(lastFrame()).toContain('2/3 selected');
  });

  it('a key clears filter (returns to all shown)', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(['a1']) });
    // Initially 1/3 selected (filtered)
    stdin.write('a');
    await delay(50);
    // After 'a', filter cleared → all shown = 3/3
    expect(lastFrame()).toContain('3/3 selected');
  });

  it('Enter with empty selection (all shown) confirms empty set', async () => {
    const { stdin, onConfirm } = setup({ selected: new Set() });
    stdin.write('\r');
    await delay(50);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0] as Set<string>;
    expect(result.size).toBe(0);
  });
});
