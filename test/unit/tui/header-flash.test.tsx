/**
 * Header tab flash animation tests.
 *
 * Tests the flash behavior when task:status_changed fires while on a different tab.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { Header } from '../../../src/tui/components/Header.js';
import { tuiColors } from '../../../src/tui/colors.js';

afterEach(() => { _resetAnimTick(); });

const defaultStats = { running: 0, retrying: 0, review: 0, todo: 0, done: 0, failed: 0, cancelled: 0, teams: 0 };
const defaultTokens = { input: 0, output: 0, total: 0 };

function renderHeader(overrides: Record<string, unknown> = {}) {
  return render(
    React.createElement(Header, {
      projectName: 'test',
      activeView: 'agents' as const,
      mode: 'idle',
      stats: defaultStats,
      tokens: defaultTokens,
      width: 100,
      ...overrides,
    }),
  );
}

describe('Header tab flash', () => {
  it('renders inactive tab in lowercase without flashTab', () => {
    const { lastFrame } = renderHeader();
    const output = lastFrame()!;
    // The tab label line should have lowercase "tasks" for inactive tab
    // (stats bar has "NO TASKS" which is unrelated)
    expect(output).toContain('T tasks');
  });

  it('shows flashing tab in uppercase when flashTab is set', () => {
    const onFlashComplete = vi.fn();
    const { lastFrame } = renderHeader({
      flashTab: 'tasks',
      flashColor: tuiColors.green,
      onFlashComplete,
    });
    const output = lastFrame()!;
    // On first render (bright phase), tab shows as uppercase pill "T TASKS"
    expect(output).toContain('T TASKS');
  });

  it('does not flash the active tab', () => {
    const onFlashComplete = vi.fn();
    const { lastFrame } = renderHeader({
      activeView: 'tasks',
      flashTab: 'tasks',
      flashColor: tuiColors.green,
      onFlashComplete,
    });
    // Active tab renders normally with amber bg — flash is suppressed
    expect(onFlashComplete).not.toHaveBeenCalled();
  });

  it('calls onFlashComplete after animation finishes', async () => {
    vi.useFakeTimers();
    const onFlashComplete = vi.fn();
    renderHeader({
      flashTab: 'tasks',
      flashColor: tuiColors.red,
      onFlashComplete,
    });

    // Each tick is 120ms, 3 blinks × 2 phases × 2 ticks = 12 ticks
    // Total: 12 × 120ms = 1440ms + extra for React flush
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(120);
      await vi.advanceTimersToNextTimerAsync();
    }

    expect(onFlashComplete).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not flash when flashColor is missing', () => {
    const onFlashComplete = vi.fn();
    const { lastFrame } = renderHeader({
      flashTab: 'tasks',
      // no flashColor
      onFlashComplete,
    });
    const output = lastFrame()!;
    // Should render as normal inactive tab
    expect(output).toContain('T tasks');
  });

  it('does not flash when onFlashComplete is missing', () => {
    const { lastFrame } = renderHeader({
      flashTab: 'tasks',
      flashColor: tuiColors.blue,
      // no onFlashComplete
    });
    const output = lastFrame()!;
    // Should render as normal inactive tab (flash requires all 3 props)
    expect(output).toContain('T tasks');
  });

  it('flashes with green for done events', () => {
    const onFlashComplete = vi.fn();
    const { lastFrame } = renderHeader({
      flashTab: 'tasks',
      flashColor: tuiColors.green,
      onFlashComplete,
    });
    expect(lastFrame()!).toContain('T TASKS');
  });

  it('flashes with red for failed events', () => {
    const onFlashComplete = vi.fn();
    const { lastFrame } = renderHeader({
      flashTab: 'tasks',
      flashColor: tuiColors.red,
      onFlashComplete,
    });
    expect(lastFrame()!).toContain('T TASKS');
  });

  it('flashes with blue for review events', () => {
    const onFlashComplete = vi.fn();
    const { lastFrame } = renderHeader({
      flashTab: 'tasks',
      flashColor: tuiColors.blue,
      onFlashComplete,
    });
    expect(lastFrame()!).toContain('T TASKS');
  });
});
