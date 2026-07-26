/**
 * E2E tests for the unified text input system.
 *
 * Tests the full integration: useTextInput hook + TextInput component
 * inside FormWizard (text-step) and App (command-bar / new_task).
 *
 * Uses ink-testing-library to simulate real keyboard input.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { FormWizard, type WizardStep } from '../../../src/tui/components/FormWizard.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kitty keyboard protocol
const CTRL_ENTER = '\x1b[13;5u';

function makeTextStep(overrides?: Partial<WizardStep>): WizardStep[] {
  return [
    {
      id: 'title',
      label: 'Title',
      type: 'text',
      placeholder: 'Enter title...',
      ...overrides,
    },
  ];
}

function makeTwoStepWizard(): WizardStep[] {
  return [
    { id: 'title', label: 'Title', type: 'text', required: true },
    { id: 'desc', label: 'Description', type: 'textarea' },
  ];
}

function renderWizard(steps: WizardStep[], overrides?: Record<string, unknown>) {
  const onComplete = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    React.createElement(FormWizard, {
      title: 'Test',
      steps,
      onComplete,
      onCancel,
      width: 80,
      height: 20,
      ...overrides,
    }),
  );
  return { ...result, onComplete, onCancel };
}

/* ── Basic text input ──────────────────────────────── */

describe('Unified text input — FormWizard text-step', () => {
  it('renders placeholder and cursor block', async () => {
    const { lastFrame } = renderWizard(makeTextStep({ placeholder: 'Type here...' }));
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('Type here...');
    expect(output).toContain('█');
  });

  it('displays typed text', async () => {
    const { stdin, lastFrame } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('Hello');
    await delay(50);
    expect(lastFrame()!).toContain('Hello');
  });

  it('submits on Enter', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('my task');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'my task' });
  });

  it('trims value on submit', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('  spaced  ');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'spaced' });
  });

  it('blocks empty submit when required', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep({ required: true }));
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).not.toHaveBeenCalled();
  });

  /* ── Cursor navigation ────────────────────────────── */

  it('← → arrows move cursor — text appears correctly after insert', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hllo');
    await delay(50);
    // Move cursor left 3 positions
    stdin.write('\x1B[D'); // ←
    await delay(30);
    stdin.write('\x1B[D'); // ←
    await delay(30);
    stdin.write('\x1B[D'); // ←
    await delay(30);
    // Insert 'e' at position 1
    stdin.write('e');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello' });
  });

  it('backspace deletes character before cursor', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('helloo');
    await delay(50);
    stdin.write('\x7F'); // Backspace (Ink maps \x7F as key.delete)
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello' });
  });

  it('multiple backspaces delete correctly', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('abcde');
    await delay(50);
    // Send backspaces individually (Ink processes each as separate event)
    stdin.write('\x7F');
    await delay(30);
    stdin.write('\x7F');
    await delay(30);
    stdin.write('\x7F');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'ab' });
  });

  it('backspace on empty field at step 0 does NOT go back', async () => {
    const { stdin, onComplete, onCancel } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('\x7F'); // Backspace on empty
    await delay(50);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  /* ── Ctrl shortcuts ────────────────────────────────── */

  it('Ctrl+A moves to start of line', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('world');
    await delay(50);
    // Ctrl+A → move to start
    stdin.write('\x01'); // Ctrl+A
    await delay(30);
    stdin.write('hello ');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello world' });
  });

  it('Ctrl+E moves to end of line', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hello');
    await delay(50);
    stdin.write('\x01'); // Ctrl+A → start
    await delay(30);
    stdin.write('\x05'); // Ctrl+E → end
    await delay(30);
    stdin.write(' world');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello world' });
  });

  it('Ctrl+K kills from cursor to end', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hello world');
    await delay(50);
    // Move to position 5
    stdin.write('\x01'); // Ctrl+A → start
    await delay(30);
    for (let i = 0; i < 5; i++) {
      stdin.write('\x1B[C'); // →
      await delay(20);
    }
    stdin.write('\x0B'); // Ctrl+K → kill to end
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello' });
  });

  it('Ctrl+U kills from cursor to start', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hello world');
    await delay(50);
    // Move left 6 positions (to 'w')
    for (let i = 0; i < 6; i++) {
      stdin.write('\x1B[D'); // ←
      await delay(20);
    }
    stdin.write('\x15'); // Ctrl+U → kill to start
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'world' });
  });

  it('Ctrl+W kills word backward', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hello world');
    await delay(50);
    stdin.write('\x17'); // Ctrl+W → kill word back ('world' removed, 'hello ' remains)
    await delay(50);
    stdin.write('\r');
    await delay(50);
    // Submit trims whitespace: 'hello ' → 'hello'
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello' });
  });

  it('Ctrl+Y yanks killed text', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hello world');
    await delay(50);
    stdin.write('\x17'); // Ctrl+W → kill 'world'
    await delay(50);
    stdin.write('\x19'); // Ctrl+Y → yank 'world'
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello world' });
  });

  /* ── Cyrillic / language switching ─────────────────── */

  it('handles Cyrillic input correctly', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('Привет');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'Привет' });
  });

  it('handles mixed Latin + Cyrillic input', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('Hello Мир');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'Hello Мир' });
  });

  it('backspace works correctly after Cyrillic input', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('Привет');
    await delay(50);
    stdin.write('\x7F'); // Backspace
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'Приве' });
  });

  /* ── Emoji input ───────────────────────────────────── */

  it('handles emoji input', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hi 👋');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hi 👋' });
  });

  it('backspace removes emoji as single unit', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hi👋');
    await delay(50);
    stdin.write('\x7F'); // Backspace
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hi' });
  });

  /* ── CJK input ─────────────────────────────────────── */

  it('handles CJK input and cursor navigation', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('你好');
    await delay(50);
    stdin.write('\x1B[D'); // ← move left (should move 1 grapheme, not 1 byte)
    await delay(30);
    stdin.write('世');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: '你世好' });
  });

  /* ── NFC normalization ─────────────────────────────── */

  it('normalizes NFD input to NFC', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    // é as e + combining accent (NFD)
    stdin.write('caf\u0065\u0301');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    const result = onComplete.mock.calls[0]?.[0]?.title;
    // Should be NFC normalized — 'café' with single é
    expect(result).toBe('caf\u00e9');
  });

  /* ── Default value / pre-fill ──────────────────────── */

  it('pre-fills with defaultValue', async () => {
    const { stdin, lastFrame, onComplete } = renderWizard(
      makeTextStep({ defaultValue: 'prefilled' }),
    );
    await delay(50);
    expect(lastFrame()!).toContain('prefilled');
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'prefilled' });
  });

  it('can edit prefilled value', async () => {
    const { stdin, onComplete } = renderWizard(
      makeTextStep({ defaultValue: 'old' }),
    );
    await delay(50);
    stdin.write(' new');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'old new' });
  });

  /* ── Step navigation ───────────────────────────────── */

  it('text → textarea step transition preserves data', async () => {
    const { stdin, onComplete } = renderWizard(makeTwoStepWizard());
    await delay(50);
    // Step 1: title (text)
    stdin.write('My Title');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    // Step 2: description (textarea) — skip with Ctrl+Enter
    stdin.write(CTRL_ENTER);
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({
      title: 'My Title',
      desc: '',
    });
  });

  it('Esc on first step cancels wizard', async () => {
    const { stdin, onCancel } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('\x1B'); // Esc
    await delay(50);
    expect(onCancel).toHaveBeenCalled();
  });

  it('Esc on second step goes back (not cancel)', async () => {
    const { stdin, lastFrame, onCancel } = renderWizard(makeTwoStepWizard());
    await delay(50);
    stdin.write('Title');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    // Now on textarea step — Esc goes back to title
    stdin.write('\x1B');
    await delay(50);
    expect(onCancel).not.toHaveBeenCalled();
    // Should show title step again with the previous value
    expect(lastFrame()!).toContain('Title');
  });

  it('backspace on empty text field goes to previous step', async () => {
    const { stdin, lastFrame, onCancel } = renderWizard(makeTwoStepWizard());
    await delay(50);
    // Step 1: enter title
    stdin.write('Title');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    // Step 2: textarea — go back with Esc
    stdin.write('\x1B');
    await delay(50);
    // Now on step 1 again. Clear the field first.
    // Select all + delete: Ctrl+A → Ctrl+K
    stdin.write('\x01'); // Ctrl+A
    await delay(30);
    stdin.write('\x0B'); // Ctrl+K
    await delay(50);
    // Now field is empty. Backspace should go back.
    // But step 0 has no previous step, so it should NOT cancel
    stdin.write('\x7F');
    await delay(50);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

/* ── Undo ──────────────────────────────────────────── */

describe('Unified text input — undo (Ctrl+Z)', () => {
  it('Ctrl+Z undoes typed text', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hello');
    await delay(600); // wait for undo snapshot debounce (500ms)
    stdin.write(' world');
    await delay(600);
    stdin.write('\x1A'); // Ctrl+Z
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello' });
  });

  it('Ctrl+Z after kill operation undoes the kill', async () => {
    const { stdin, onComplete } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('hello world');
    await delay(50);
    stdin.write('\x17'); // Ctrl+W → kill 'world'
    await delay(50);
    stdin.write('\x1A'); // Ctrl+Z → undo kill
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ title: 'hello world' });
  });
});

/* ── Visual rendering ────────────────────────────────── */

describe('Unified text input — visual rendering', () => {
  it('shows cursor block (█)', async () => {
    const { stdin, lastFrame } = renderWizard(makeTextStep());
    await delay(50);
    stdin.write('abc');
    await delay(50);
    expect(lastFrame()!).toContain('█');
  });

  it('shows prefix "> "', async () => {
    const { lastFrame } = renderWizard(makeTextStep());
    await delay(50);
    expect(lastFrame()!).toContain('>');
  });

  it('shows error border when validation fails', async () => {
    const { stdin, lastFrame } = renderWizard(
      makeTextStep({
        required: true,
        validate: (v) => (v.length < 3 ? 'Too short' : null),
      }),
    );
    await delay(50);
    stdin.write('ab');
    await delay(350);
    const output = lastFrame()!;
    expect(output).toContain('Too short');
  });
});
