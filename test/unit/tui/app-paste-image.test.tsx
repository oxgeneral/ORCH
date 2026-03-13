/**
 * Integration test: Ctrl+V image paste during task creation wizard.
 *
 * Verifies that:
 * 1. handlePasteImage is called on Ctrl+V in wizard text step
 * 2. pendingAttachments are accumulated
 * 3. Attachments are passed to onCreateTask on wizard completion
 * 4. UI shows attachment feedback (📎 badge, status message)
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { App } from '../../../src/tui/App.js';
import type { Task } from '../../../src/domain/task.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import type { OrchestratorState } from '../../../src/domain/state.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kitty keyboard protocol CSI u sequences
const CTRL_V = '\x1b[118;5u';

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

// Mock clipboard-service so it returns a fake PNG image
vi.mock('../../../src/infrastructure/clipboard-service.js', () => ({
  detectClipboardType: vi.fn().mockResolvedValue('image'),
  getClipboardImage: vi.fn().mockResolvedValue({
    data: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    ext: 'png',
  }),
}));

afterEach(() => { _resetAnimTick(); });

describe('App paste image during task wizard', () => {
  it('passes attachments to onCreateTask after Ctrl+V paste in wizard', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let receivedAttachments: string[] | undefined;
    let receivedTitle = '';

    const onCreateTask = async (title: string, opts?: { priority?: number; description?: string; attachments?: string[] }) => {
      receivedTitle = title;
      receivedAttachments = opts?.attachments;
      return makeTask({ id: 'tsk_new', title, attachments: opts?.attachments });
    };

    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );

    // Step 1: Open wizard with 'n' key
    stdin.write('n');
    await delay(100);
    expect(lastFrame()!).toContain('NEW TASK');

    // Step 2: Type title
    stdin.write('Task with image');
    await delay(50);

    // Step 3: Paste image via Ctrl+V
    stdin.write(CTRL_V);
    await delay(300); // Give time for async clipboard mock + temp file write

    // Check feedback — should show 📎 badge in footer
    const afterPaste = lastFrame()!;
    // The footerExtra should show 📎1
    expect(afterPaste).toContain('\uD83D\uDCCE'); // 📎

    // Step 4: Submit title step
    stdin.write('\r');
    await delay(50);

    // Step 5: Priority — accept default (P3)
    stdin.write('\r');
    await delay(50);

    // Step 6: Description (textarea) — skip
    stdin.write('\r');
    await delay(200);

    // Verify task was created with attachments
    expect(receivedTitle).toBe('Task with image');
    expect(receivedAttachments).toBeDefined();
    expect(receivedAttachments!.length).toBe(1);
    expect(receivedAttachments![0]).toContain('clipboard-');
    expect(receivedAttachments![0]).toContain('.png');
  });

  it('shows image attached status message after Ctrl+V', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async (title: string) => makeTask({ id: 'tsk_x', title });

    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );

    // Open wizard
    stdin.write('n');
    await delay(100);

    // Type title
    stdin.write('Test');
    await delay(50);

    // Paste image
    stdin.write(CTRL_V);
    await delay(300);

    // Cancel wizard to go back to activity feed where message is shown
    stdin.write('\x1B'); // Escape — back to title (step 0)
    await delay(50);
    stdin.write('\x1B'); // Escape — cancel wizard
    await delay(100);

    const output = lastFrame()!;
    // Activity feed should have "Image attached" message
    expect(output).toContain('Image attached');
  });

  it('accumulates multiple paste operations', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let receivedAttachments: string[] | undefined;

    const onCreateTask = async (title: string, opts?: { priority?: number; description?: string; attachments?: string[] }) => {
      receivedAttachments = opts?.attachments;
      return makeTask({ id: 'tsk_multi', title });
    };

    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );

    // Open wizard
    stdin.write('n');
    await delay(100);

    // Type title
    stdin.write('Multi attach');
    await delay(50);

    // Paste image twice
    stdin.write(CTRL_V);
    await delay(300);
    stdin.write(CTRL_V);
    await delay(300);

    // Check 📎2 badge
    const afterPaste = lastFrame()!;
    expect(afterPaste).toContain('2'); // 📎2

    // Complete wizard
    stdin.write('\r'); // submit title
    await delay(50);
    stdin.write('\r'); // priority
    await delay(50);
    stdin.write('\r'); // description
    await delay(200);

    // Two attachments should have been passed
    expect(receivedAttachments).toBeDefined();
    expect(receivedAttachments!.length).toBe(2);
  });

  it('clears pendingAttachments on wizard cancel', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let receivedAttachments: string[] | undefined;

    const onCreateTask = async (title: string, opts?: { priority?: number; description?: string; attachments?: string[] }) => {
      receivedAttachments = opts?.attachments;
      return makeTask({ id: 'tsk_cancel', title });
    };

    const { stdin } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );

    // Open wizard, paste image, cancel
    stdin.write('n');
    await delay(100);
    stdin.write('Cancel me');
    await delay(50);
    stdin.write(CTRL_V);
    await delay(300);
    stdin.write('\x1B'); // Back to step 0
    await delay(50);
    stdin.write('\x1B'); // Cancel wizard
    await delay(100);

    // Open wizard again and create task without paste
    stdin.write('n');
    await delay(100);
    stdin.write('Clean task');
    await delay(50);
    stdin.write('\r'); // title
    await delay(50);
    stdin.write('\r'); // priority
    await delay(50);
    stdin.write('\r'); // description
    await delay(200);

    // Should have NO attachments
    expect(receivedAttachments).toBeUndefined();
  });
});
