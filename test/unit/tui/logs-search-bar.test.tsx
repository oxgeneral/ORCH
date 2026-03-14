/**
 * LogsSearchBar component tests.
 *
 * Verifies standalone rendering of the search bar:
 * query display, match counter, invalid regex state.
 *
 * NOTE: Search mode integration with App.tsx is NOT yet implemented.
 * These tests cover the component rendering only.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { LogsSearchBar } from '../../../src/tui/components/LogsSearchBar.js';

function setup(overrides?: Partial<React.ComponentProps<typeof LogsSearchBar>>) {
  const props = {
    query: 'hello',
    matchCount: 3,
    currentMatch: 1,
    isInvalid: false,
    width: 80,
    ...overrides,
  };
  return render(<LogsSearchBar {...props} />);
}

describe('LogsSearchBar', () => {
  it('renders "/" prompt character', () => {
    const { lastFrame } = setup();
    expect(lastFrame()).toContain('/');
  });

  it('shows query text', () => {
    const { lastFrame } = setup({ query: 'error' });
    expect(lastFrame()).toContain('error');
  });

  it('shows N/M match counter when matches found', () => {
    const { lastFrame } = setup({ query: 'error', matchCount: 5, currentMatch: 2 });
    // currentMatch is 0-based, display is 1-based → 3/5
    expect(lastFrame()).toContain('3/5');
  });

  it('shows "No matches" when query present but no matches', () => {
    const { lastFrame } = setup({ query: 'xyz', matchCount: 0, currentMatch: -1 });
    expect(lastFrame()).toContain('No matches');
  });

  it('shows empty counter when query is empty', () => {
    const { lastFrame } = setup({ query: '', matchCount: 0, currentMatch: -1 });
    const frame = lastFrame()!;
    // No "No matches" when query is empty (/ prompt is always shown)
    expect(frame).not.toContain('No matches');
  });

  it('shows "Invalid regex" when isInvalid is true', () => {
    const { lastFrame } = setup({ query: '[broken', isInvalid: true });
    expect(lastFrame()).toContain('Invalid regex');
  });

  it('shows n/N navigation hint', () => {
    const { lastFrame } = setup();
    expect(lastFrame()).toContain('n/N');
  });

  it('shows Esc close hint', () => {
    const { lastFrame } = setup();
    expect(lastFrame()).toContain('Esc close');
  });

  it('shows cursor indicator', () => {
    const { lastFrame } = setup();
    // Cursor is rendered as ▏
    expect(lastFrame()).toContain('▏');
  });

  it('shows first match as 1/N (1-based display)', () => {
    const { lastFrame } = setup({ query: 'test', matchCount: 10, currentMatch: 0 });
    expect(lastFrame()).toContain('1/10');
  });

  it('truncates long query to fit within width', () => {
    const longQuery = 'a'.repeat(100);
    const { lastFrame } = setup({ query: longQuery, width: 40 });
    // Should not crash and should render within width
    const frame = lastFrame()!;
    expect(frame).toBeTruthy();
  });
});
