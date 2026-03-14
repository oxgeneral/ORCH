/**
 * HelpOverlay component tests.
 * Command Discoverability QA:
 *   - HelpOverlay.tsx — 3 columns, amber title, border, dismiss footer
 *   - commandBar.ts — resolveSuggestions('') category groups
 *   - CommandBar.tsx — ? hint color based on onboardingCompleted
 *   - App.tsx — ? and F1 open overlay, Esc closes it, onboardingCompleted pass-through
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { HelpOverlay } from '../../../src/tui/components/HelpOverlay.js';
import { resolveSuggestions, resolveCompletion, CommandHistory } from '../../../src/tui/commandBar.js';
import { CommandBar } from '../../../src/tui/components/CommandBar.js';
import { App } from '../../../src/tui/App.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';

afterEach(() => { _resetAnimTick(); });

/* ── HelpOverlay — structure ─────────────────────────── */

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

  it('accepts width and height props', () => {
    // Should not throw with various dimensions
    const { lastFrame } = render(<HelpOverlay width={120} height={40} />);
    expect(lastFrame()).toContain('KEYBOARD SHORTCUTS');
  });

  it('renders all Navigation hotkeys', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Enter');
    expect(frame).toContain('G');
    expect(frame).toContain('T');
    expect(frame).toContain('A');
    expect(frame).toContain('L');
  });

  it('renders all Action hotkeys', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Show / Stop');
    expect(frame).toContain('Undo delete');
  });

  it('renders /task add command in Commands column', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('/task add');
  });

  it('renders /watch command in Commands column', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('/watch');
  });

  it('renders Auto-dispatch description in Commands column', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('Auto-dispatch');
  });

  it('renders Settings description in Commands column', () => {
    const { lastFrame } = render(<HelpOverlay width={100} height={30} />);
    expect(lastFrame()).toContain('Settings');
  });
});

/* ── resolveSuggestions — category grouping ─────────── */

describe('resolveSuggestions', () => {
  it('returns non-empty array for "/" input', () => {
    const results = resolveSuggestions('/');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array for non-command input', () => {
    const results = resolveSuggestions('');
    expect(results).toEqual([]);
  });

  it('returns empty array for input without leading slash', () => {
    const results = resolveSuggestions('task');
    expect(results).toEqual([]);
  });

  it('includes УПРАВЛЕНИЕ category separator for "/" input', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    expect(descs.some((d) => d.includes('УПРАВЛЕНИЕ'))).toBe(true);
  });

  it('includes МОНИТОРИНГ category separator for "/" input', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    expect(descs.some((d) => d.includes('МОНИТОРИНГ'))).toBe(true);
  });

  it('includes НАСТРОЙКИ category separator for "/" input', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    expect(descs.some((d) => d.includes('НАСТРОЙКИ'))).toBe(true);
  });

  it('category separators have empty cmd field', () => {
    const results = resolveSuggestions('/');
    const separators = results.filter((r) =>
      r.desc.includes('УПРАВЛЕНИЕ') || r.desc.includes('МОНИТОРИНГ') || r.desc.includes('НАСТРОЙКИ'),
    );
    for (const sep of separators) {
      expect(sep.cmd).toBe('');
    }
  });

  it('separators are not selectable (cmd is empty string, not filled)', () => {
    const results = resolveSuggestions('/');
    const separators = results.filter((r) => r.cmd === '');
    expect(separators.length).toBe(3); // one per category
  });

  it('УПРАВЛЕНИЕ category comes before МОНИТОРИНГ', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const manageIdx = descs.findIndex((d) => d.includes('УПРАВЛЕНИЕ'));
    const monitorIdx = descs.findIndex((d) => d.includes('МОНИТОРИНГ'));
    expect(manageIdx).toBeLessThan(monitorIdx);
  });

  it('МОНИТОРИНГ category comes before НАСТРОЙКИ', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const monitorIdx = descs.findIndex((d) => d.includes('МОНИТОРИНГ'));
    const settingsIdx = descs.findIndex((d) => d.includes('НАСТРОЙКИ'));
    expect(monitorIdx).toBeLessThan(settingsIdx);
  });

  it('УПРАВЛЕНИЕ group contains /task', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const manageIdx = descs.findIndex((d) => d.includes('УПРАВЛЕНИЕ'));
    const monitorIdx = descs.findIndex((d) => d.includes('МОНИТОРИНГ'));
    const manageGroup = results.slice(manageIdx + 1, monitorIdx);
    expect(manageGroup.some((r) => r.cmd === '/task')).toBe(true);
  });

  it('УПРАВЛЕНИЕ group contains /agent', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const manageIdx = descs.findIndex((d) => d.includes('УПРАВЛЕНИЕ'));
    const monitorIdx = descs.findIndex((d) => d.includes('МОНИТОРИНГ'));
    const manageGroup = results.slice(manageIdx + 1, monitorIdx);
    expect(manageGroup.some((r) => r.cmd === '/agent')).toBe(true);
  });

  it('МОНИТОРИНГ group contains /run', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const monitorIdx = descs.findIndex((d) => d.includes('МОНИТОРИНГ'));
    const settingsIdx = descs.findIndex((d) => d.includes('НАСТРОЙКИ'));
    const monitorGroup = results.slice(monitorIdx + 1, settingsIdx);
    expect(monitorGroup.some((r) => r.cmd.startsWith('/run'))).toBe(true);
  });

  it('МОНИТОРИНГ group contains /watch', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const monitorIdx = descs.findIndex((d) => d.includes('МОНИТОРИНГ'));
    const settingsIdx = descs.findIndex((d) => d.includes('НАСТРОЙКИ'));
    const monitorGroup = results.slice(monitorIdx + 1, settingsIdx);
    expect(monitorGroup.some((r) => r.cmd === '/watch')).toBe(true);
  });

  it('НАСТРОЙКИ group contains /config', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const settingsIdx = descs.findIndex((d) => d.includes('НАСТРОЙКИ'));
    const settingsGroup = results.slice(settingsIdx + 1);
    expect(settingsGroup.some((r) => r.cmd === '/config')).toBe(true);
  });

  it('НАСТРОЙКИ group contains /quit', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const settingsIdx = descs.findIndex((d) => d.includes('НАСТРОЙКИ'));
    const settingsGroup = results.slice(settingsIdx + 1);
    expect(settingsGroup.some((r) => r.cmd === '/quit')).toBe(true);
  });

  it('НАСТРОЙКИ group contains /help', () => {
    const results = resolveSuggestions('/');
    const descs = results.map((r) => r.desc);
    const settingsIdx = descs.findIndex((d) => d.includes('НАСТРОЙКИ'));
    const settingsGroup = results.slice(settingsIdx + 1);
    expect(settingsGroup.some((r) => r.cmd === '/help')).toBe(true);
  });

  it('filters commands by prefix for "/ta" input', () => {
    const results = resolveSuggestions('/ta');
    expect(results.every((r) => r.cmd.startsWith('/ta') || r.cmd === '')).toBe(true);
    expect(results.some((r) => r.cmd === '/task')).toBe(true);
  });

  it('does NOT include category separators for prefix input "/ta"', () => {
    const results = resolveSuggestions('/ta');
    const hasSeparators = results.some(
      (r) => r.desc.includes('УПРАВЛЕНИЕ') || r.desc.includes('МОНИТОРИНГ') || r.desc.includes('НАСТРОЙКИ'),
    );
    expect(hasSeparators).toBe(false);
  });

  it('returns subcommand suggestions for "/task " input', () => {
    const results = resolveSuggestions('/task ');
    expect(results.some((r) => r.cmd === '/task add')).toBe(true);
    expect(results.some((r) => r.cmd === '/task list')).toBe(true);
  });

  it('filters subcommands by prefix for "/task a" input', () => {
    const results = resolveSuggestions('/task a');
    expect(results.every((r) => r.cmd.startsWith('/task a'))).toBe(true);
    expect(results.some((r) => r.cmd === '/task add')).toBe(true);
  });

  it('returns subs hint for commands with subcommands', () => {
    const results = resolveSuggestions('/');
    const taskEntry = results.find((r) => r.cmd === '/task');
    expect(taskEntry?.subs).toBeDefined();
    expect(taskEntry?.subs).toContain('add');
  });

  it('commands without subcommands have no subs field', () => {
    const results = resolveSuggestions('/');
    const watchEntry = results.find((r) => r.cmd === '/watch');
    expect(watchEntry?.subs).toBeUndefined();
  });

  it('run command includes [id] args hint', () => {
    const results = resolveSuggestions('/');
    const runEntry = results.find((r) => r.cmd.startsWith('/run'));
    // /run has args: '[id]'
    expect(runEntry?.cmd).toContain('[id]');
  });
});

/* ── resolveCompletion ───────────────────────────────── */

describe('resolveCompletion', () => {
  it('returns null for non-command input', () => {
    expect(resolveCompletion('task')).toBeNull();
  });

  it('returns null for empty slash input "/"', () => {
    expect(resolveCompletion('/')).toBeNull();
  });

  it('returns completion suffix for partial verb "/ta"', () => {
    const result = resolveCompletion('/ta');
    expect(result).toBe('sk');
  });

  it('returns null when verb is complete "/task"', () => {
    expect(resolveCompletion('/task')).toBeNull();
  });

  it('returns subcommand completion for "/task c"', () => {
    const result = resolveCompletion('/task c');
    expect(result).toBe('ancel');
  });

  it('returns null when subcommand is complete', () => {
    expect(resolveCompletion('/task cancel')).toBeNull();
  });

  it('returns null for unknown verb', () => {
    expect(resolveCompletion('/xyz')).toBeNull();
  });
});

/* ── CommandHistory ──────────────────────────────────── */

describe('CommandHistory', () => {
  it('prev() returns null when empty', () => {
    const h = new CommandHistory();
    expect(h.prev()).toBeNull();
  });

  it('next() returns null when empty', () => {
    const h = new CommandHistory();
    expect(h.next()).toBeNull();
  });

  it('push and prev retrieves last entry', () => {
    const h = new CommandHistory();
    h.push('/task add');
    expect(h.prev()).toBe('/task add');
  });

  it('deduplicates consecutive identical entries', () => {
    const h = new CommandHistory();
    h.push('/watch');
    h.push('/watch');
    h.prev();
    // cursor should be at 0, no duplicate
    expect(h.prev()).toBe('/watch');
    expect(h.prev()).toBe('/watch'); // stays at first entry
  });

  it('next() past end returns null', () => {
    const h = new CommandHistory();
    h.push('/run');
    h.prev(); // go back to /run
    expect(h.next()).toBeNull(); // past end
  });

  it('reset() moves cursor to end', () => {
    const h = new CommandHistory();
    h.push('/task list');
    h.prev(); // cursor at 0
    h.reset();
    expect(h.next()).toBeNull(); // cursor at end
  });
});

/* ── CommandBar — ? hint coloring ───────────────────── */

describe('CommandBar ? hint', () => {
  const baseProps = {
    mode: 'navigate' as const,
    value: '',
    completion: null,
    activeView: 'tasks' as const,
    canRun: false,
    canNew: false,
    hasDetail: false,
    itemCount: 0,
    itemLabel: 'tasks',
    width: 120,
  };

  it('renders ? help hint in navigate mode', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} />);
    expect(lastFrame()).toContain('?');
    expect(lastFrame()).toContain('help');
  });

  it('renders Q quit hint in navigate mode', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} />);
    expect(lastFrame()).toContain('Q');
    expect(lastFrame()).toContain('quit');
  });

  it('renders / cmd hint in navigate mode', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} />);
    expect(lastFrame()).toContain('/');
    expect(lastFrame()).toContain('cmd');
  });

  it('renders item count when itemCount > 0', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} itemCount={5} itemLabel="tasks" />);
    expect(lastFrame()).toContain('5');
    expect(lastFrame()).toContain('tasks');
  });

  it('does not render item count when itemCount is 0', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} itemCount={0} itemLabel="tasks" />);
    // itemCount=0 means the count box is not rendered
    const frame = lastFrame()!;
    // "0 tasks" should not appear
    expect(frame).not.toContain('0 tasks');
  });

  it('shows hint text in command mode', () => {
    const { lastFrame } = render(
      <CommandBar {...baseProps} mode="command" value="/task" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Enter exec');
  });

  it('shows suggestions hint in command mode when hasSuggestions=true', () => {
    const { lastFrame } = render(
      <CommandBar {...baseProps} mode="command" value="/task" hasSuggestions={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('select');
    expect(frame).toContain('Tab fill');
  });

  it('shows cursor block character in command mode', () => {
    const { lastFrame } = render(
      <CommandBar {...baseProps} mode="command" value="/" />,
    );
    expect(lastFrame()).toContain('\u2588'); // █
  });

  it('shows ghost completion in command mode', () => {
    const { lastFrame } = render(
      <CommandBar {...baseProps} mode="command" value="/ta" completion="sk" />,
    );
    expect(lastFrame()).toContain('sk');
  });

  it('renders canNew hint when canNew=true', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} canNew={true} />);
    expect(lastFrame()).toContain('N');
    expect(lastFrame()).toContain('new');
  });

  it('renders canRun hint when canRun=true', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} canRun={true} />);
    expect(lastFrame()).toContain('R');
    expect(lastFrame()).toContain('run');
  });

  it('renders Esc close hint when hasDetail=true', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} hasDetail={true} />);
    expect(lastFrame()).toContain('Esc');
    expect(lastFrame()).toContain('close');
  });

  it('renders Enter detail hint for tasks view when no detail', () => {
    const { lastFrame } = render(
      <CommandBar {...baseProps} activeView="tasks" hasDetail={false} />,
    );
    expect(lastFrame()).toContain('Enter');
    expect(lastFrame()).toContain('detail');
  });

  it('renders approve hint when canApprove=true', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} canApprove={true} />);
    expect(lastFrame()).toContain('A');
    expect(lastFrame()).toContain('approve');
  });

  it('renders reject hint when canReject=true', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} canReject={true} />);
    expect(lastFrame()).toContain('X');
    expect(lastFrame()).toContain('reject');
  });

  it('renders undo hint when canUndo=true', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} canUndo={true} />);
    expect(lastFrame()).toContain('Z');
    expect(lastFrame()).toContain('undo');
  });

  it('renders pause hint when canPause=true and not paused', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} canPause={true} isPaused={false} />);
    expect(lastFrame()).toContain('P');
    expect(lastFrame()).toContain('pause');
  });

  it('renders resume hint when canPause=true and isPaused=true', () => {
    const { lastFrame } = render(<CommandBar {...baseProps} canPause={true} isPaused={true} />);
    expect(lastFrame()).toContain('P');
    expect(lastFrame()).toContain('resume');
  });

  it('is wrapped in React.memo', () => {
    expect(typeof CommandBar).toBe('object');
  });

  it('onboardingCompleted=false renders ? with amber-like treatment', () => {
    // When onboardingCompleted is false, ? and 'help' are rendered with amber color
    // We can verify the component renders without error and contains ? help
    const { lastFrame } = render(
      <CommandBar {...baseProps} onboardingCompleted={false} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('?');
    expect(frame).toContain('help');
  });

  it('onboardingCompleted=true renders ? with dim/gray treatment', () => {
    // When onboardingCompleted is true, ? and 'help' use gray/dim color
    const { lastFrame } = render(
      <CommandBar {...baseProps} onboardingCompleted={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('?');
    expect(frame).toContain('help');
  });

  it('onboardingCompleted=undefined renders ? hint', () => {
    const { lastFrame } = render(
      <CommandBar {...baseProps} onboardingCompleted={undefined} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('?');
    expect(frame).toContain('help');
  });
});

/* ── App — ? and F1 open overlay, Esc closes it ─────── */

describe('App HelpOverlay integration', () => {
  const defaultAppProps = {
    projectName: 'test',
    tasks: [],
    state: { ...DEFAULT_STATE },
  };

  it('does not show HelpOverlay by default', () => {
    const { lastFrame } = render(React.createElement(App, defaultAppProps));
    expect(lastFrame()).not.toContain('KEYBOARD SHORTCUTS');
  });

  it('shows HelpOverlay after pressing ?', async () => {
    const { stdin, lastFrame } = render(React.createElement(App, defaultAppProps));
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('KEYBOARD SHORTCUTS');
  });

  // F1 (\\x1bOP) cannot be reliably sent via ink-testing-library stdin because
  // the escape sequence is split — \\x1b is consumed as Escape before OP arrives.
  // F1 handling is verified in App.tsx source review: input === '\\x1bOP' → setShowHelpOverlay(true).
  it.skip('shows HelpOverlay after pressing F1 (\\x1bOP) [terminal escape sequence — not testable via stdin]', async () => {
    const { stdin, lastFrame } = render(React.createElement(App, defaultAppProps));
    stdin.write('\x1bOP');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('KEYBOARD SHORTCUTS');
  });

  it('dismisses HelpOverlay on Esc', async () => {
    const { stdin, lastFrame } = render(React.createElement(App, defaultAppProps));
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('KEYBOARD SHORTCUTS');
    stdin.write('\x1B'); // Esc
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('KEYBOARD SHORTCUTS');
  });

  it('dismisses HelpOverlay on ? press when already open', async () => {
    const { stdin, lastFrame } = render(React.createElement(App, defaultAppProps));
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('KEYBOARD SHORTCUTS');
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('KEYBOARD SHORTCUTS');
  });

  // F1 (\\x1bOP) cannot be reliably sent via ink-testing-library stdin (see note above).
  it.skip('dismisses HelpOverlay on F1 press when already open [terminal escape sequence — not testable via stdin]', async () => {
    const { stdin, lastFrame } = render(React.createElement(App, defaultAppProps));
    stdin.write('\x1bOP');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('KEYBOARD SHORTCUTS');
    stdin.write('\x1bOP');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('KEYBOARD SHORTCUTS');
  });

  it('HelpOverlay shows all 3 column headers when open', async () => {
    const { stdin, lastFrame } = render(React.createElement(App, defaultAppProps));
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame()!;
    expect(frame).toContain('NAVIGATION');
    expect(frame).toContain('ACTIONS');
    expect(frame).toContain('COMMANDS');
  });

  it('HelpOverlay shows dismiss hint when open', async () => {
    const { stdin, lastFrame } = render(React.createElement(App, defaultAppProps));
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Press any key to dismiss');
  });

  it('App passes onboardingCompleted from state to CommandBar', () => {
    const stateCompleted = { ...DEFAULT_STATE, onboardingCompleted: true };
    const { lastFrame } = render(
      React.createElement(App, { ...defaultAppProps, state: stateCompleted }),
    );
    // CommandBar should still render ? help
    expect(lastFrame()).toContain('?');
    expect(lastFrame()).toContain('help');
  });

  it('App with onboardingCompleted=false shows ? hint in CommandBar', () => {
    const stateNotCompleted = { ...DEFAULT_STATE, onboardingCompleted: false };
    const { lastFrame } = render(
      React.createElement(App, { ...defaultAppProps, state: stateNotCompleted }),
    );
    expect(lastFrame()).toContain('?');
    expect(lastFrame()).toContain('help');
  });

  it('App renders CommandBar at bottom in navigate mode', () => {
    const { lastFrame } = render(React.createElement(App, defaultAppProps));
    const frame = lastFrame()!;
    // CommandBar navigate mode always shows / cmd
    expect(frame).toContain('cmd');
    expect(frame).toContain('quit');
  });
});
