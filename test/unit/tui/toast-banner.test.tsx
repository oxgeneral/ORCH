/**
 * ToastBanner component tests.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ToastBanner, type Toast } from '../../../src/tui/components/ToastBanner.js';

function makeToast(overrides: Partial<Toast> & { id: string }): Toast {
  return {
    type: 'done',
    title: 'Implement auth',
    agentName: 'Backend A',
    ts: Date.now(),
    ...overrides,
  };
}

describe('ToastBanner', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing when toasts array is empty', () => {
    const { lastFrame } = render(<ToastBanner toasts={[]} onDismiss={() => {}} />);
    expect(lastFrame()).toBe('');
  });

  it('renders a done toast with checkmark icon and agent name', () => {
    const toast = makeToast({ id: 't1', type: 'done', title: 'Fix bug', agentName: 'QA' });
    const { lastFrame } = render(<ToastBanner toasts={[toast]} onDismiss={() => {}} />);
    const frame = lastFrame();
    expect(frame).toContain('\u2713'); // ✓
    expect(frame).toContain('Fix bug');
    expect(frame).toContain('Task completed by QA');
  });

  it('renders a failed toast with cross icon', () => {
    const toast = makeToast({ id: 't2', type: 'failed', title: 'Deploy' });
    const { lastFrame } = render(<ToastBanner toasts={[toast]} onDismiss={() => {}} />);
    const frame = lastFrame();
    expect(frame).toContain('\u2715'); // ✕
    expect(frame).toContain('Deploy');
    expect(frame).toContain('Task failed');
    expect(frame).toContain('press Enter for details');
  });

  it('renders a review toast with lozenge icon', () => {
    const toast = makeToast({ id: 't3', type: 'review', title: 'Auth flow' });
    const { lastFrame } = render(<ToastBanner toasts={[toast]} onDismiss={() => {}} />);
    const frame = lastFrame();
    expect(frame).toContain('\u25C8'); // ◈
    expect(frame).toContain('Auth flow');
    expect(frame).toContain('Task ready for review');
    expect(frame).toContain('press A to approve');
  });

  it('shows max 2 toasts even when more provided', () => {
    const toasts = [
      makeToast({ id: 't1', title: 'First' }),
      makeToast({ id: 't2', title: 'Second' }),
      makeToast({ id: 't3', title: 'Third' }),
    ];
    const { lastFrame } = render(<ToastBanner toasts={toasts} onDismiss={() => {}} />);
    const frame = lastFrame();
    expect(frame).toContain('First');
    expect(frame).toContain('Second');
    expect(frame).not.toContain('Third');
  });

  it('truncates long titles at 40 chars', () => {
    const longTitle = 'A'.repeat(50);
    const toast = makeToast({ id: 't1', title: longTitle });
    const { lastFrame } = render(<ToastBanner toasts={[toast]} onDismiss={() => {}} />);
    const frame = lastFrame();
    expect(frame).toContain('A'.repeat(39) + '\u2026');
    expect(frame).not.toContain('A'.repeat(50));
  });

  it('auto-dismisses done toast after 4s + fade', () => {
    const onDismiss = vi.fn();
    const toast = makeToast({ id: 't1', type: 'done' });
    render(<ToastBanner toasts={[toast]} onDismiss={onDismiss} />);

    // Before auto-dismiss time
    vi.advanceTimersByTime(3999);
    expect(onDismiss).not.toHaveBeenCalled();

    // After auto-dismiss + fade-out (4000 + 360)
    vi.advanceTimersByTime(361);
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('auto-dismisses failed toast after 8s + fade', () => {
    const onDismiss = vi.fn();
    const toast = makeToast({ id: 't1', type: 'failed' });
    render(<ToastBanner toasts={[toast]} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(7999);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(361);
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('auto-dismisses review toast after 6s + fade', () => {
    const onDismiss = vi.fn();
    const toast = makeToast({ id: 't1', type: 'review' });
    render(<ToastBanner toasts={[toast]} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(5999);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(361);
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('falls back to "Agent" when agentName is undefined', () => {
    const toast = makeToast({ id: 't1', type: 'done', agentName: undefined });
    const { lastFrame } = render(<ToastBanner toasts={[toast]} onDismiss={() => {}} />);
    expect(lastFrame()).toContain('Task completed by Agent');
  });
});
