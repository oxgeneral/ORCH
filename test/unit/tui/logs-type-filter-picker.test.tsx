/**
 * LogsTypeFilterPicker tests.
 *
 * Tests multi-select popup for log message type filtering:
 * navigation, toggle, presets, confirm/cancel.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { LogsTypeFilterPicker } from '../../../src/tui/components/LogsTypeFilterPicker.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ALL_TYPES = ['system', 'lifecycle', 'output', 'tool', 'result', 'error', 'file', 'info'];

function setup(overrides?: { selected?: Set<string>; typeCounts?: Record<string, number> }) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const selected = overrides?.selected ?? new Set<string>(ALL_TYPES);
  const typeCounts = overrides?.typeCounts ?? { system: 5, output: 100, error: 3, tool: 42 };

  const { lastFrame, stdin } = render(
    <LogsTypeFilterPicker
      selected={selected}
      typeCounts={typeCounts}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { lastFrame, stdin, onConfirm, onCancel };
}

describe('LogsTypeFilterPicker', () => {
  it('renders header and all 8 types', () => {
    const { lastFrame } = setup();
    const frame = lastFrame();
    expect(frame).toContain('Type Filter');
    expect(frame).toContain('System');
    expect(frame).toContain('Lifecycle');
    expect(frame).toContain('Output');
    expect(frame).toContain('Tool calls');
    expect(frame).toContain('Results');
    expect(frame).toContain('Errors');
    expect(frame).toContain('Files');
    expect(frame).toContain('Info');
  });

  it('shows message counts for types with messages', () => {
    const { lastFrame } = setup({ typeCounts: { error: 7, tool: 15 } });
    const frame = lastFrame();
    expect(frame).toContain('·7');
    expect(frame).toContain('·15');
  });

  it('shows preset hints at bottom', () => {
    const { lastFrame } = setup();
    const frame = lastFrame();
    expect(frame).toContain('1=all');
    expect(frame).toContain('2=text');
    expect(frame).toContain('3=tools');
    expect(frame).toContain('4=errors');
    expect(frame).toContain('5=events');
  });

  it('shows selected count in header', () => {
    const { lastFrame } = setup();
    const frame = lastFrame();
    expect(frame).toContain('8/8 selected');
  });

  it('shows partial count when some types deselected', () => {
    const { lastFrame } = setup({ selected: new Set(['output', 'error']) });
    const frame = lastFrame();
    expect(frame).toContain('2/8 selected');
  });

  it('Space toggles type off', async () => {
    const { lastFrame, stdin } = setup();
    // Cursor starts at system (index 0). Space deselects it.
    stdin.write(' ');
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('7/8 selected');
  });

  it('Space toggles type on after off', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(['output']) });
    // Cursor at system (index 0) which is off. Space selects it.
    stdin.write(' ');
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('2/8 selected');
  });

  it('down arrow moves cursor', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(ALL_TYPES) });
    // Move down to lifecycle (index 1), then toggle
    stdin.write('\x1B[B'); // down
    await delay(50);
    stdin.write(' '); // toggle lifecycle off
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('7/8 selected');
  });

  it('preset 1 selects all types', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(['error']) });
    stdin.write('1');
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('8/8 selected');
  });

  it('preset 2 selects only output (text)', async () => {
    const { lastFrame, stdin } = setup();
    stdin.write('2');
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('1/8 selected');
  });

  it('preset 3 selects tools group', async () => {
    const { lastFrame, stdin } = setup();
    stdin.write('3');
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('3/8 selected');
  });

  it('preset 4 selects only errors', async () => {
    const { lastFrame, stdin } = setup();
    stdin.write('4');
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('1/8 selected');
  });

  it('preset 5 selects events group', async () => {
    const { lastFrame, stdin } = setup();
    stdin.write('5');
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('2/8 selected');
  });

  it('a toggles select all / deselect all', async () => {
    const { lastFrame, stdin } = setup();
    // All selected → deselect all
    stdin.write('a');
    await delay(50);
    expect(lastFrame()).toContain('0/8 selected');
    // Deselected → select all
    stdin.write('a');
    await delay(50);
    expect(lastFrame()).toContain('8/8 selected');
  });

  it('Enter confirms with current selection', async () => {
    const { stdin, onConfirm } = setup({ selected: new Set(['error', 'output']) });
    stdin.write('\r');
    await delay(50);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0] as Set<string>;
    expect(result.has('error')).toBe(true);
    expect(result.has('output')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('Enter with empty selection confirms all types', async () => {
    const { stdin, onConfirm } = setup();
    // Deselect all then confirm
    stdin.write('a'); // deselect all
    await delay(50);
    stdin.write('\r'); // confirm
    await delay(50);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0] as Set<string>;
    expect(result.size).toBe(8);
  });

  it('Escape cancels without calling onConfirm', async () => {
    const { stdin, onConfirm, onCancel } = setup();
    stdin.write('\x1B');
    await delay(50);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cursor wraps from bottom to top', async () => {
    const { lastFrame, stdin } = setup({ selected: new Set(ALL_TYPES) });
    // Move up from first item should wrap to last (info)
    stdin.write('\x1B[A'); // up
    await delay(50);
    stdin.write(' '); // toggle info off
    await delay(50);
    const frame = lastFrame();
    expect(frame).toContain('7/8 selected');
  });

  it('shows footer with controls hint', () => {
    const { lastFrame } = setup();
    const frame = lastFrame();
    expect(frame).toContain('Space toggle');
    expect(frame).toContain('Enter confirm');
    expect(frame).toContain('Esc cancel');
  });
});
