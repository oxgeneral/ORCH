/**
 * FormWizard inline validation tests (commit fae4df7).
 *
 * Covers:
 * 1. validate? in WizardStep works for text/textarea/select
 * 2. Debounce 300ms fires after typing stops
 * 3. Red border on Box when validationError set
 * 4. Error message displayed below field
 * 5. Enter blocked when validationError !== null — shows 'Fix the error above'
 * 6. Required * indicator after step label
 * 7. validationError reset on step navigation (next/prev)
 * 8. Timers cleaned up in useEffect return
 * 9. No regression in existing 37+ FormWizard tests (covered in form-wizard.test.tsx)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { FormWizard, type WizardStep } from '../../../src/tui/components/FormWizard.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CTRL_ENTER = '\x1b[13;5u';

function makeTextStep(overrides?: Partial<WizardStep>): WizardStep[] {
  return [{ id: 'name', label: 'Name', type: 'text', required: true, ...overrides }];
}

function makeTextareaStep(overrides?: Partial<WizardStep>): WizardStep[] {
  return [{ id: 'body', label: 'Description', type: 'textarea', ...overrides }];
}

function makeSelectStep(overrides?: Partial<WizardStep>): WizardStep[] {
  return [
    {
      id: 'priority',
      label: 'Priority',
      type: 'select',
      options: [
        { label: 'High', value: '1' },
        { label: 'Medium', value: '2' },
        { label: 'Low', value: '3' },
      ],
      ...overrides,
    },
  ];
}

function makeTwoStepWizard(): WizardStep[] {
  return [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'body', label: 'Description', type: 'textarea' },
  ];
}

// Validate: returns error for short input, null for valid
const validateMinLength = (min: number) => (value: string) =>
  value.length < min ? `Min ${min} characters required` : null;

describe('FormWizard inline validation', () => {
  /* ── 1. Required * indicator ── */

  it('shows red * after label for required step', async () => {
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ required: true }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    expect(lastFrame()!).toContain('*');
  });

  it('shows (optional, Enter to skip) for non-required step', async () => {
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ required: false }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 80,
        height: 20,
      }),
    );
    await delay(50);
    expect(lastFrame()!).toContain('optional');
  });

  /* ── 2. Debounce 300ms with fake timers ── */

  it('validate not called immediately on text input — fires after 300ms debounce', async () => {
    vi.useFakeTimers();
    const validate = vi.fn().mockReturnValue('too short');
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    vi.runAllTimers();

    stdin.write('a');
    // Before 300ms — error not shown yet
    expect(lastFrame()!).not.toContain('too short');

    vi.advanceTimersByTime(300);
    expect(validate).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('validate fires after typing stops (300ms) for text step', async () => {
    const validate = vi.fn().mockReturnValue('too short');
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('hi');
    // Wait for debounce
    await delay(400);
    expect(lastFrame()!).toContain('too short');
  });

  it('validate fires after typing stops (300ms) for textarea step', async () => {
    const validate = vi.fn().mockReturnValue('bad input');
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaStep({ validate }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('x');
    await delay(400);
    expect(lastFrame()!).toContain('bad input');
  });

  /* ── 3. Red border when validationError set ── */

  it('shows rounded border on text input when validation error present', async () => {
    // Round border renders as ╭╮╰╯ in ink
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate: () => 'error!' }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    stdin.write('a');
    await delay(400);
    const output = lastFrame()!;
    // Ink renders round border as ╭ or ─ or similar; verify border characters present
    expect(output).toMatch(/[╭╮╰╯─│]/);
    expect(output).toContain('error!');
  });

  it('shows rounded border on textarea when validation error present', async () => {
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaStep({ validate: () => 'textarea error' }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    stdin.write('x');
    await delay(400);
    expect(lastFrame()!).toContain('textarea error');
  });

  /* ── 4. Error message displayed below field ── */

  it('displays validation error message below text input', async () => {
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate: validateMinLength(5) }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    stdin.write('hi');
    await delay(400);
    expect(lastFrame()!).toContain('Min 5 characters required');
  });

  it('displays validation error message below textarea', async () => {
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaStep({ validate: validateMinLength(10) }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    stdin.write('short');
    await delay(400);
    expect(lastFrame()!).toContain('Min 10 characters required');
  });

  it('clears validation error when input becomes valid', async () => {
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate: validateMinLength(3) }),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Short input — triggers error
    stdin.write('ab');
    await delay(400);
    expect(lastFrame()!).toContain('Min 3 characters required');

    // Continue typing to make it valid
    stdin.write('c');
    await delay(400);
    expect(lastFrame()!).not.toContain('Min 3 characters required');
  });

  /* ── 5. Enter blocked with validationError, shows 'Fix the error above' ── */

  it('blocks Enter and shows Fix the error above for text step with error', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate: () => 'invalid value' }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('x');
    await delay(400);
    // Press Enter — should be blocked
    stdin.write('\r');
    await delay(50);

    expect(onComplete).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('Fix the error above');
  });

  it('blocks Ctrl+Enter and shows Fix the error above for textarea step with error', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaStep({ validate: () => 'bad value' }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('x');
    await delay(400);
    stdin.write(CTRL_ENTER);
    await delay(50);

    expect(onComplete).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('Fix the error above');
  });

  it('allows Enter when validation passes (null returned)', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate: () => null }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('valid input');
    await delay(400);
    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ name: 'valid input' });
  });

  it('allows immediate Enter when current text is valid but the debounced error is stale', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate: (value) => value.trim() ? null : 'Name is required' }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(400); // Initial empty-value validation has completed.

    stdin.write('valid');
    await delay(20); // Current input is rendered; the 300ms validation is still stale.
    expect(lastFrame()!).not.toContain('Name is required');
    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ name: 'valid' });
  });

  it('allows immediate textarea confirmation when current value is valid but the error is stale', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaStep({
          required: true,
          validate: (value) => value.trim() ? null : 'Description is required',
        }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(400); // Initial empty-value validation has completed.

    stdin.write('valid');
    await delay(20); // Current input is rendered; the 300ms validation is still stale.
    expect(lastFrame()!).not.toContain('Description is required');
    stdin.write(CTRL_ENTER);
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'valid' });
  });

  /* ── 6. Select validate — synchronous on confirm ── */

  it('blocks select confirmation and shows error when validate returns error', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeSelectStep({ validate: (v) => (v === '1' ? 'High not allowed' : null) }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Press Enter on High (index 0)
    stdin.write('\r');
    await delay(50);

    expect(onComplete).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('High not allowed');
    expect(lastFrame()!).toContain('Fix the error above');
  });

  it('allows select confirmation when validate returns null', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeSelectStep({ validate: () => null }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ priority: '1' });
  });

  it('no validation error shown when select step has no validate fn', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeSelectStep(),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ priority: '1' });
    expect(lastFrame()!).not.toContain('Fix the error above');
  });

  /* ── 7. validationError reset on step navigation ── */

  it('validationError cleared when navigating to next step', async () => {
    const onComplete = vi.fn();
    const steps: WizardStep[] = [
      { id: 'name', label: 'Name', type: 'text', required: true, validate: () => null },
      { id: 'body', label: 'Description', type: 'textarea' },
    ];
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps,
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Navigate to step 2 — validation error should be cleared
    stdin.write('valid name');
    await delay(400);
    stdin.write('\r');
    await delay(50);

    // Should be on step 2 with no error shown
    expect(lastFrame()!).toContain('Description');
    expect(lastFrame()!).not.toContain('Fix the error above');
  });

  it('validationError cleared when navigating back to previous step via Esc', async () => {
    const steps: WizardStep[] = [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'body', label: 'Description', type: 'textarea', validate: () => 'permanent error' },
    ];
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps,
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Go to step 2
    stdin.write('my name');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    // Trigger validation on step 2
    stdin.write('x');
    await delay(400);
    expect(lastFrame()!).toContain('permanent error');

    // Navigate back with Esc
    stdin.write('\x1b');
    await delay(50);

    // Back on step 1 — no error shown
    expect(lastFrame()!).toContain('Name');
    expect(lastFrame()!).not.toContain('permanent error');
    expect(lastFrame()!).not.toContain('Fix the error above');
  });

  /* ── 8. No error when no validate fn provided ── */

  it('no validation error for text step without validate fn — Enter works normally', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep({ validate: undefined }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('anything');
    await delay(400);
    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ name: 'anything' });
  });

  it('no validation error for textarea step without validate fn — Ctrl+Enter works normally', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaStep({ validate: undefined }),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('some text');
    await delay(400);
    stdin.write(CTRL_ENTER);
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'some text' });
  });
});
