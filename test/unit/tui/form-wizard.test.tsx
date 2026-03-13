/**
 * FormWizard textarea tests.
 *
 * Tests multiline textarea input: Shift+Enter adds line, Enter confirms,
 * cursor navigation, backspace behavior, hint bar, and visual elements.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { FormWizard, type WizardStep } from '../../../src/tui/components/FormWizard.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kitty keyboard protocol CSI u sequence for Shift+Enter (codepoint 13, modifier 2=shift+1)
const SHIFT_ENTER = '\x1b[13;2u';

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
    expect(output).toContain('Shift+Enter newline');
    expect(output).toContain('Enter confirm');
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

  /* ── Shift+Enter adds new line ── */

  it('Shift+Enter adds a new line in textarea', async () => {
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

    // Press Shift+Enter → new line
    stdin.write(SHIFT_ENTER);
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

  /* ── Enter confirms textarea ── */

  it('Enter confirms textarea and calls onComplete', async () => {
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
    // Enter to confirm
    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'Hello world' });
  });

  it('Enter confirms multiline textarea with newlines joined', async () => {
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
    stdin.write(SHIFT_ENTER); // Shift+Enter → new line
    await delay(50);
    stdin.write('second');
    await delay(50);
    stdin.write('\r'); // Enter → confirm
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'first\nsecond' });
  });

  it('Enter on empty required textarea does not confirm', async () => {
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

    // Enter on empty required field
    stdin.write('\r');
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
    stdin.write(SHIFT_ENTER); // Shift+Enter → new line
    await delay(50);
    stdin.write('BBBB');
    await delay(50);

    // Press up arrow → go to line 1
    stdin.write('\x1B[A'); // up arrow
    await delay(50);

    // Type X → inserts on line 1
    stdin.write('X');
    await delay(50);

    // Confirm with Enter
    stdin.write('\r');
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
    stdin.write(SHIFT_ENTER); // Shift+Enter → new line
    await delay(50);
    // Cursor is at line 2, col 0

    // Press left → should wrap to end of line 1 (after B)
    stdin.write('\x1B[D'); // left
    await delay(50);

    // Type X → should append to line 1 → "ABX"
    stdin.write('X');
    await delay(50);

    stdin.write('\r'); // Enter → confirm
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
    stdin.write(SHIFT_ENTER); // Shift+Enter → new line
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

    stdin.write('\r'); // Enter → confirm
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
    stdin.write(SHIFT_ENTER); // Shift+Enter → new line
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
    stdin.write('\r'); // Enter → confirm
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

  it('Backspace on empty textarea at step > 0 does NOT go back (use Esc)', async () => {
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

    // Step 2: textarea — backspace on empty should NOT go back
    stdin.write('\x7F');
    await delay(50);

    // Should still be on textarea step (not back on text step)
    expect(lastFrame()!).toContain('Shift+Enter newline');
    expect(lastFrame()!).toContain('Description');
  });

  it('erasing description to empty does not navigate back to title', async () => {
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

    // Step 1: type title and confirm
    stdin.write('My Title');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    // Step 2: type description, then erase it all with backspace
    stdin.write('Hello');
    await delay(50);
    // 5 backspaces to erase "Hello"
    for (let i = 0; i < 5; i++) {
      stdin.write('\x7F');
      await delay(20);
    }
    // One more backspace on empty — should NOT go back
    stdin.write('\x7F');
    await delay(50);

    // Should still be on textarea step
    expect(lastFrame()!).toContain('Shift+Enter newline');
    expect(lastFrame()!).toContain('Description');
  });

  it('Esc on textarea at step > 0 goes back to previous step', async () => {
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

    // Step 2: textarea — Esc goes back
    stdin.write('\x1B');
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
    expect(output).toContain('Shift+Enter newline'); // textarea hint

    // Type multiline
    stdin.write('Line A');
    await delay(50);
    stdin.write(SHIFT_ENTER); // Shift+Enter → new line
    await delay(50);
    stdin.write('Line B');
    await delay(50);

    // Confirm with Enter
    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({
      title: 'My Title',
      body: 'Line A\nLine B',
    });
  });

  /* ── Multiline paste ── */

  it('paste multiline text splits into separate lines', async () => {
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

    // Paste multiline text (simulates Ctrl+V with newlines)
    stdin.write('line1\nline2\nline3');
    await delay(50);

    stdin.write('\r'); // Enter → confirm
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'line1\nline2\nline3' });
  });

  it('paste multiline text in the middle of existing text', async () => {
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

    stdin.write('HelloWorld');
    await delay(50);

    // Move cursor left 5 chars (between Hello and World)
    for (let i = 0; i < 5; i++) {
      stdin.write('\x1B[D');
      await delay(20);
    }

    // Paste multiline in the middle
    stdin.write('A\nB\nC');
    await delay(50);

    stdin.write('\r');
    await delay(50);

    // Expected: "HelloA\nB\nCWorld"
    expect(onComplete).toHaveBeenCalledWith({ body: 'HelloA\nB\nCWorld' });
  });

  it('paste with Windows-style \\r\\n line endings', async () => {
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

    stdin.write('first\r\nsecond\r\nthird');
    await delay(50);

    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'first\nsecond\nthird' });
  });

  it('Backspace merge sets taCursorCol to prevLine.length (no setTimeout race)', async () => {
    // Verify fix for ed11250: mergedCol computed outside setTaLines updater,
    // setTaCursorCol called synchronously after setTaLines (not via setTimeout).
    // After merging "Hello" + "World" with cursor at col 0 of line 2,
    // typing a character should insert at col 5 (after "Hello"), not at col 0.
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

    // Type "Hello", add new line, type "World"
    stdin.write('Hello');
    await delay(50);
    stdin.write(SHIFT_ENTER);
    await delay(50);
    stdin.write('World');
    await delay(50);

    // Move to start of "World" line (5x left)
    for (let i = 0; i < 5; i++) {
      stdin.write('\x1B[D');
      await delay(20);
    }

    // Backspace at col 0 → merge lines, cursor lands at col 5 ("Hello".length)
    stdin.write('\x7F');
    await delay(100);

    // Type "X" — cursor at col 5 gives "HelloXWorld"
    // Old bug (setTimeout race): cursor at col 0 would give "XHelloWorld"
    stdin.write('X');
    await delay(50);

    stdin.write('\r');
    await delay(50);

    expect(onComplete).toHaveBeenCalledWith({ body: 'HelloXWorld' });
  });
});

describe('FormWizard clipboard paste (onPasteImage / footerExtra)', () => {
  // Kitty keyboard protocol CSI u: codepoint 105 ('i'), modifier 5 (ctrl+1)
  const CTRL_I = '\x1b[105;5u';
  // Kitty keyboard protocol CSI u: codepoint 118 ('v'), modifier 5 (ctrl+1)
  const CTRL_V = '\x1b[118;5u';

  function makeTextStep(): WizardStep[] {
    return [{ id: 'title', label: 'Title', type: 'text', required: true }];
  }

  function makeSelectStep(): WizardStep[] {
    return [
      {
        id: 'priority',
        label: 'Priority',
        type: 'select',
        options: [
          { label: 'High', value: '1' },
          { label: 'Medium', value: '2' },
        ],
      },
    ];
  }

  it('calls onPasteImage on Ctrl+I for text step', async () => {
    const onPasteImage = vi.fn().mockResolvedValue('image');
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
        onPasteImage,
      }),
    );
    await delay(50);
    stdin.write(CTRL_I);
    await delay(50);
    expect(onPasteImage).toHaveBeenCalledTimes(1);
  });

  it('calls onPasteImage on Ctrl+I for textarea step', async () => {
    const onPasteImage = vi.fn().mockResolvedValue('image');
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
        onPasteImage,
      }),
    );
    await delay(50);
    stdin.write(CTRL_I);
    await delay(50);
    expect(onPasteImage).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onPasteImage on Ctrl+I for select step', async () => {
    const onPasteImage = vi.fn().mockResolvedValue('image');
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeSelectStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
        onPasteImage,
      }),
    );
    await delay(50);
    stdin.write(CTRL_I);
    await delay(50);
    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it('does NOT call onPasteImage when prop is undefined', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
        // onPasteImage not provided
      }),
    );
    await delay(50);
    stdin.write(CTRL_I);
    await delay(50);
    // No crash — test passes if we get here
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('calls onPasteImage on Ctrl+V for text step', async () => {
    const onPasteImage = vi.fn().mockResolvedValue('image');
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
        onPasteImage,
      }),
    );
    await delay(50);
    stdin.write(CTRL_V);
    await delay(50);
    expect(onPasteImage).toHaveBeenCalledTimes(1);
  });

  it('calls onPasteImage on Ctrl+V for textarea step', async () => {
    const onPasteImage = vi.fn().mockResolvedValue('image');
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextareaSteps(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
        onPasteImage,
      }),
    );
    await delay(50);
    stdin.write(CTRL_V);
    await delay(50);
    expect(onPasteImage).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onPasteImage on Ctrl+V for select step', async () => {
    const onPasteImage = vi.fn().mockResolvedValue('image');
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeSelectStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 60,
        height: 20,
        onPasteImage,
      }),
    );
    await delay(50);
    stdin.write(CTRL_V);
    await delay(50);
    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it('does NOT call onPasteImage on Ctrl+V when prop is undefined', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete,
        onCancel: vi.fn(),
        width: 60,
        height: 20,
      }),
    );
    await delay(50);
    stdin.write(CTRL_V);
    await delay(50);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows Ctrl+V hint in footer when onPasteImage provided for text step', async () => {
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 80,
        height: 20,
        onPasteImage: vi.fn().mockResolvedValue('empty'),
      }),
    );
    await delay(50);
    expect(lastFrame()!).toContain('paste image');
  });

  it('does NOT show paste hint when onPasteImage not provided', async () => {
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 80,
        height: 20,
      }),
    );
    await delay(50);
    expect(lastFrame()!).not.toContain('Ctrl+V paste image');
  });

  it('renders footerExtra text when provided', async () => {
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 80,
        height: 20,
        footerExtra: '📎2',
      }),
    );
    await delay(50);
    expect(lastFrame()!).toContain('📎2');
  });

  it('does NOT render footerExtra when not provided', async () => {
    const { lastFrame } = render(
      React.createElement(FormWizard, {
        title: 'Test',
        steps: makeTextStep(),
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        width: 80,
        height: 20,
      }),
    );
    await delay(50);
    // Should not contain the 📎 indicator
    expect(lastFrame()!).not.toContain('📎');
  });
});
