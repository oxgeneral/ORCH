/**
 * FormWizard textarea tests.
 *
 * Tests multiline textarea input: Enter adds line, Tab confirms,
 * cursor navigation, backspace behavior, hint bar, and visual elements.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { FormWizard, type WizardStep } from '../../../src/tui/components/FormWizard.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Minimal textarea-only wizard for isolated testing
function makeTextareaSteps(overrides?: Partial<WizardStep>): WizardStep[] {
  return [
    {
      id: 'body',
      label: 'Description',
      type: 'textarea',
      placeholder: 'Enter description...',
      ...overrides,
    },
  ];
}

// Two-step wizard: text input → textarea
function makeTextThenTextareaSteps(): WizardStep[] {
  return [
    {
      id: 'title',
      label: 'Title',
      type: 'text',
      required: true,
    },
    {
      id: 'body',
      label: 'Description',
      type: 'textarea',
      placeholder: 'Details...',
    },
  ];
}

describe('FormWizard textarea', () => {
  /* ── Rendering ── */

  it('renders textarea with line numbers and │ border', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    const output = lastFrame()!;
    // Line number 1
    expect(output).toContain('1');
    // Vertical border character
    expect(output).toContain('│');
    // Block cursor
    expect(output).toContain('█');
  });

  it('shows placeholder on empty textarea', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps({ placeholder: 'Type here...' }),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    expect(lastFrame()!).toContain('Type here...');
  });

  /* ── Hint bar ── */

  it('shows correct hint bar for textarea type', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('Enter newline');
    expect(output).toContain('Tab confirm');
    expect(output).toContain('navigate');
  });

  it('shows correct hint bar for text type', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextThenTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('←→ move');
    expect(output).toContain('Enter confirm');
  });

  /* ── Enter adds new line ── */

  it('Enter adds a new line in textarea', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Type first line
    stdin.write('line one');
    await delay(50);
    expect(lastFrame()!).toContain('line one');

    // Press Enter → new line
    stdin.write('\r');
    await delay(50);

    // Type second line
    stdin.write('line two');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('line one');
    expect(output).toContain('line two');
    // Should show line number 2
    expect(output).toContain('2');
  });

  /* ── Tab confirms textarea ── */

  it('Tab confirms textarea and calls onComplete', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('Hello world');
    await delay(50);
    // Tab to confirm
    stdin.write('\t');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'Hello world' });
  });

  it('Tab confirms multiline textarea with newlines joined', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('first');
    await delay(50);
    stdin.write('\r'); // Enter → new line
    await delay(50);
    stdin.write('second');
    await delay(50);
    stdin.write('\t'); // Tab → confirm
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'first\nsecond' });
  });

  it('Tab on empty required textarea does not confirm', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps({ required: true }),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Tab on empty required field
    stdin.write('\t');
    await delay(50);

    expect(onComplete).not.toHaveBeenCalled();
  });

  /* ── Cursor navigation ── */

  it('←→ arrows move cursor in textarea', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('ABC');
    await delay(50);

    // Move left twice → cursor between A and B
    stdin.write('\x1B[D'); // left arrow
    await delay(30);
    stdin.write('\x1B[D'); // left arrow
    await delay(30);

    // Type X → should insert between A and BC → "AXBC"
    stdin.write('X');
    await delay(50);
    // Cursor █ splits rendered text: "AX█BC"
    const output = lastFrame()!;
    expect(output).toContain('AX');
    expect(output).toContain('BC');
  });

  it('↑↓ arrows navigate between lines in textarea', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Create two lines
    stdin.write('AAAA');
    await delay(50);
    stdin.write('\r'); // Enter → new line
    await delay(50);
    stdin.write('BBBB');
    await delay(50);

    // Press up arrow → go to line 1
    stdin.write('\x1B[A'); // up arrow
    await delay(50);

    // Type X → inserts on line 1
    stdin.write('X');
    await delay(50);

    // Confirm with Tab
    stdin.write('\t');
    await delay(50);

    // The result should have X on the first line
    const result = onComplete.mock.calls[0]?.[0]?.body;
    expect(result).toContain('X');
    expect(result).toContain('BBBB');
  });

  it('← at start of line wraps to end of previous line', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('AB');
    await delay(50);
    stdin.write('\r'); // new line
    await delay(50);
    // Cursor is at line 2, col 0

    // Press left → should wrap to end of line 1 (after B)
    stdin.write('\x1B[D'); // left
    await delay(50);

    // Type X → should append to line 1 → "ABX"
    stdin.write('X');
    await delay(50);

    stdin.write('\t'); // confirm
    await delay(50);

    // .trim() in goToNextStep removes trailing newline
    expect(onComplete).toHaveBeenCalledWith({ body: 'ABX' });
  });

  it('→ at end of line wraps to start of next line', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('AB');
    await delay(50);
    stdin.write('\r'); // new line
    await delay(50);
    stdin.write('CD');
    await delay(50);

    // Go to line 1
    stdin.write('\x1B[A'); // up
    await delay(50);
    // Cursor should be at line 1, col 2 (end of "AB")
    // Press right → should wrap to line 2, col 0
    stdin.write('\x1B[C'); // right
    await delay(50);
    // Type X → should insert at start of line 2 → "XCD"
    stdin.write('X');
    await delay(50);

    stdin.write('\t');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'AB\nXCD' });
  });

  /* ── Backspace ── */

  it('Backspace deletes character in middle of textarea line', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('ABCD');
    await delay(50);

    // Move left once (cursor after D → after C)
    stdin.write('\x1B[D');
    await delay(30);
    // Backspace → delete C → "ABD"
    stdin.write('\x7F');
    await delay(50);

    // Cursor █ splits rendered text: "AB█D"
    expect(lastFrame()!).toContain('AB');
    expect(lastFrame()!).not.toContain('ABCD');
  });

  it('Backspace at start of line merges with previous line', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    stdin.write('Hello');
    await delay(50);
    stdin.write('\r'); // new line
    await delay(50);
    stdin.write('World');
    await delay(50);

    // Move to start of line 2
    // Press Home or 5x left
    for (let i = 0; i < 5; i++) {
      stdin.write('\x1B[D');
      await delay(20);
    }
    // Backspace at col 0 → merge lines
    stdin.write('\x7F');
    await delay(100);

    // Confirm
    stdin.write('\t');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'HelloWorld' });
  });

  it('Backspace on empty textarea at step 0 does nothing (no cancel)', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Backspace on empty textarea at step 0 — code checks currentStep > 0
    stdin.write('\x7F');
    await delay(50);

    // Should NOT cancel — still on step 0
    expect(onCancel).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('Description');
  });

  it('Backspace on empty textarea at step > 0 goes back', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextThenTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Step 1: text input → type and confirm
    stdin.write('Title');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    // Step 2: textarea — backspace on empty → go back to step 1
    stdin.write('\x7F');
    await delay(50);

    // Should be back on text step
    expect(lastFrame()!).toContain('Title');
    expect(lastFrame()!).toContain('←→ move');
  });

  /* ── Text input cursor navigation ── */

  it('←→ arrows move cursor in text input', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextThenTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Type in text input
    stdin.write('AB');
    await delay(50);

    // Move left
    stdin.write('\x1B[D');
    await delay(30);

    // Type X → "AXB", cursor splits: "AX█B"
    stdin.write('X');
    await delay(50);
    expect(lastFrame()!).toContain('AX');
    expect(lastFrame()!).not.toContain('ABX');
  });

  /* ── Default value for textarea ── */

  it('pre-fills textarea with defaultValue', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps({ defaultValue: 'pre-filled\ncontent' }),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('pre-filled');
    expect(output).toContain('content');
  });

  /* ── Textarea in multi-step wizard ── */

  it('textarea works as non-first step after text input', async () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextThenTextareaSteps(),
        onComplete,
        onCancel,
        width: 60,
        height: 20,
      }),
    );
    await delay(50);

    // Step 1: text input
    stdin.write('My Title');
    await delay(50);
    stdin.write('\r'); // confirm text
    await delay(50);

    // Step 2: textarea
    const output = lastFrame()!;
    expect(output).toContain('Description');
    expect(output).toContain('Enter newline'); // textarea hint

    // Type multiline
    stdin.write('Line A');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    stdin.write('Line B');
    await delay(50);

    // Confirm with Tab
    stdin.write('\t');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({
      title: 'My Title',
      body: 'Line A\nLine B',
    });
  });
});
