/**
 * HelpOverlay component tests.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { HelpOverlay } from '../../../src/tui/components/HelpOverlay.js';

describe('HelpOverlay', () => {
  it('renders title KEYBOARD SHORTCUTS', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('KEYBOARD SHORTCUTS');
  });

  it('renders Navigation section', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame();
    expect(frame).toContain('NAVIGATION');
    expect(frame).toContain('Navigate');
    expect(frame).toContain('Switch tabs');
    expect(frame).toContain('Goals tab');
    expect(frame).toContain('Tasks tab');
    expect(frame).toContain('Agents tab');
    expect(frame).toContain('Logs tab');
  });

  it('renders Actions section', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame();
    expect(frame).toContain('ACTIONS');
    expect(frame).toContain('New item');
    expect(frame).toContain('Edit');
    expect(frame).toContain('Delete');
    expect(frame).toContain('Run task');
    expect(frame).toContain('Approve');
    expect(frame).toContain('Autonomous');
    expect(frame).toContain('Undo delete');
  });

  it('renders Commands section', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame();
    expect(frame).toContain('COMMANDS');
    expect(frame).toContain('Command mode');
    expect(frame).toContain('/task add');
    expect(frame).toContain('/run');
    expect(frame).toContain('/watch');
    expect(frame).toContain('/config');
    expect(frame).toContain('/help');
    expect(frame).toContain('/quit');
  });

  it('renders dismiss footer', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('Press any key to dismiss');
  });

  it('renders box border characters', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame();
    expect(frame).toContain('\u256D'); // ╭
    expect(frame).toContain('\u256E'); // ╮
    expect(frame).toContain('\u2570'); // ╰
    expect(frame).toContain('\u256F'); // ╯
  });

  it('renders column separators', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('\u2502'); // │
  });

  it('renders detail view shortcut for Enter', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('Detail view');
  });

  it('renders review workflow shortcuts', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame();
    expect(frame).toContain('Cancel');
    expect(frame).toContain('Reject');
  });

  it('is wrapped in React.memo', () => {
    expect(HelpOverlay).toBeDefined();
    expect(typeof HelpOverlay).toBe('object'); // React.memo returns object
  });

  it('renders all 3 section dividers', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame();
    expect(frame).toContain('NAVIGATION');
    expect(frame).toContain('ACTIONS');
    expect(frame).toContain('COMMANDS');
  });
});
