/**
 * Integration test: Ctrl+V image paste during task creation wizard.
 *
 * Verifies that:
 * 1. handlePasteImage is called on Ctrl+V in wizard text step
 * 2. pendingAttachments are accumulated
 * 3. Attachments are passed to onCreateTask on wizard completion
 * 4. UI shows attachment feedback (📎 badge, status message)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { App } from '../../../src/tui/App.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import type { OrchestratorState } from '../../../src/domain/state.js';
import { makeTask } from '../application/helpers.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kitty keyboard protocol CSI u sequence for Ctrl+V (codepoint 118, modifier 5=ctrl+1)
const CTRL_V = '\x1b[118;5u';

// Mock clipboard-service so it returns a fake PNG image
vi.mock('../../../src/infrastructure/clipboard-service.js', () => ({
  detectClipboardType: vi.fn().mockResolvedValue('image'),
  getClipboardImage: vi.fn().mockResolvedValue({
    data: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    ext: 'png',
  }),
}));

afterEach(() => {
  _resetAnimTick();
  vi.clearAllMocks();
});

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

    // Open wizard → type title → paste image → complete wizard
    stdin.write('n');
    await delay(100);
    expect(lastFrame()!).toContain('NEW TASK');

    stdin.write('Task with image');
    await delay(50);

    stdin.write(CTRL_V);
    await delay(150);

    // Footer should show 📎 badge
    expect(lastFrame()!).toContain('\uD83D\uDCCE'); // 📎

    stdin.write('\r'); // submit title
    await delay(50);
    stdin.write('\r'); // priority (default P3)
    await delay(50);
    stdin.write('\r'); // description (skip)
    await delay(150);

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

    stdin.write('n');
    await delay(100);
    stdin.write('Test');
    await delay(50);
    stdin.write(CTRL_V);
    await delay(150);

    // Cancel wizard to reveal activity feed with status message
    stdin.write('\x1B'); // Escape — back to step 0
    await delay(50);
    stdin.write('\x1B'); // Escape — cancel wizard
    await delay(100);

    expect(lastFrame()!).toContain('Image attached');
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

    stdin.write('n');
    await delay(100);
    stdin.write('Multi attach');
    await delay(50);

    stdin.write(CTRL_V);
    await delay(150);
    stdin.write(CTRL_V);
    await delay(150);

    // Badge should show 📎2
    expect(lastFrame()!).toContain('2');

    stdin.write('\r'); // title
    await delay(50);
    stdin.write('\r'); // priority
    await delay(50);
    stdin.write('\r'); // description
    await delay(150);

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
    await delay(150);
    stdin.write('\x1B'); // back to step 0
    await delay(50);
    stdin.write('\x1B'); // cancel wizard
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
    await delay(150);

    expect(receivedAttachments).toBeUndefined();
  });
});
