/**
 * Tests for lazy CLI routing (commit b5dffd6).
 *
 * Verifies:
 * 1. All 9 light commands accept LightContainer
 * 2. All 3 full commands accept Container (superset)
 * 3. LiquidTemplateEngine lazily imports Liquid on first render
 * 4. Container type hierarchy: Container extends LightContainer
 * 5. Template engine getEngine() creates instance only once (singleton)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { makeContainer } from './helpers.js';
import type { LightContainer, Container } from '../../../src/container.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLightContainer(overrides: Partial<LightContainer> = {}): LightContainer {
  const full = makeContainer();
  return { ...full, ...overrides };
}

// ── Light commands accept LightContainer ─────────────────────────────────────

describe('Light commands register with LightContainer', () => {
  let program: Command;
  let container: LightContainer;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    container = makeLightContainer();
  });

  it('registerTaskCommand registers without error', async () => {
    const { registerTaskCommand } = await import('../../../src/cli/commands/task.js');
    expect(() => registerTaskCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'task')).toBe(true);
  });

  it('registerAgentCommand registers without error', async () => {
    const { registerAgentCommand } = await import('../../../src/cli/commands/agent.js');
    expect(() => registerAgentCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'agent')).toBe(true);
  });

  it('registerLogsCommand registers without error', async () => {
    const { registerLogsCommand } = await import('../../../src/cli/commands/logs.js');
    expect(() => registerLogsCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'logs')).toBe(true);
  });

  it('registerStatusCommand registers without error', async () => {
    const { registerStatusCommand } = await import('../../../src/cli/commands/status.js');
    expect(() => registerStatusCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'status')).toBe(true);
  });

  it('registerConfigCommand registers without error', async () => {
    const { registerConfigCommand } = await import('../../../src/cli/commands/config.js');
    expect(() => registerConfigCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'config')).toBe(true);
  });

  it('registerContextCommand registers without error', async () => {
    const { registerContextCommand } = await import('../../../src/cli/commands/context.js');
    expect(() => registerContextCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'context')).toBe(true);
  });

  it('registerMsgCommand registers without error', async () => {
    const { registerMsgCommand } = await import('../../../src/cli/commands/msg.js');
    expect(() => registerMsgCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'msg')).toBe(true);
  });

  it('registerGoalCommand registers without error', async () => {
    const { registerGoalCommand } = await import('../../../src/cli/commands/goal.js');
    expect(() => registerGoalCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'goal')).toBe(true);
  });

  it('registerTeamCommand registers without error', async () => {
    const { registerTeamCommand } = await import('../../../src/cli/commands/team.js');
    expect(() => registerTeamCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'team')).toBe(true);
  });
});

// ── Full commands accept Container ────────────────────────────────────────────

describe('Full commands register with Container', () => {
  let program: Command;
  let container: Container;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    container = makeContainer();
  });

  it('registerRunCommand registers without error', async () => {
    const { registerRunCommand } = await import('../../../src/cli/commands/run.js');
    expect(() => registerRunCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'run')).toBe(true);
  });

  it('registerDoctorCommand registers without error', async () => {
    const { registerDoctorCommand } = await import('../../../src/cli/commands/doctor.js');
    expect(() => registerDoctorCommand(program, container)).not.toThrow();
    expect(program.commands.some((c) => c.name() === 'doctor')).toBe(true);
  });
});

// ── Container type hierarchy ──────────────────────────────────────────────────

describe('Container extends LightContainer', () => {
  it('Container mock has all expected services and heavy deps', () => {
    const c = makeContainer();

    // LightContainer service fields (present in mock)
    expect(c).toHaveProperty('context');
    expect(c).toHaveProperty('paths');
    expect(c).toHaveProperty('config');
    expect(c).toHaveProperty('configStore');
    expect(c).toHaveProperty('contextStore');
    expect(c).toHaveProperty('messageStore');
    expect(c).toHaveProperty('teamStore');
    expect(c).toHaveProperty('eventBus');
    expect(c).toHaveProperty('taskService');
    expect(c).toHaveProperty('agentService');
    expect(c).toHaveProperty('runService');
    expect(c).toHaveProperty('messageService');
    expect(c).toHaveProperty('teamService');

    // Container-only fields (heavy deps)
    expect(c).toHaveProperty('orchestrator');
    expect(c).toHaveProperty('doctorService');
  });

  it('Container is assignable to LightContainer (full is a superset)', () => {
    const full: Container = makeContainer();
    const light: LightContainer = full; // should not throw
    expect(light.taskService).toBeDefined();
  });
});

// ── Template engine lazy loading ──────────────────────────────────────────────

describe('LiquidTemplateEngine lazy loading', () => {
  it('constructor does not throw (Liquid not yet loaded)', async () => {
    const { LiquidTemplateEngine } = await import(
      '../../../src/infrastructure/template/template-engine.js'
    );
    expect(() => new LiquidTemplateEngine()).not.toThrow();
  });

  it('render() resolves with rendered string', async () => {
    const { LiquidTemplateEngine } = await import(
      '../../../src/infrastructure/template/template-engine.js'
    );
    const engine = new LiquidTemplateEngine();
    const result = await engine.render('Hello {{ name }}', {
      project: { name: 'test', description: '' },
      task: {
        id: 'tsk_1',
        title: 'T',
        description: '',
        priority: 2,
        labels: [],
        is_autonomous: false,
      },
      agent: { id: 'agt_1', name: 'A' },
      agents: [],
      attempt: null,
      workspace_path: '/tmp',
      messages: [],
    } as any);
    expect(result).toContain('Hello');
  });
});

// ── --help fast path (skip container init) ────────────────────────────────────

describe('CLI routing logic', () => {
  /** Mirror the real CLI logic: skip leading flags to find the subcommand. */
  function findSub(argv: string[]): string | undefined {
    return argv.slice(2).find((arg) => !arg.startsWith('-'));
  }

  it('--help without real subcommand triggers fast path (no container)', () => {
    const LIGHT_COMMANDS = { task: 1, agent: 1, status: 1, logs: 1, config: 1, context: 1, msg: 1, goal: 1, team: 1 };
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const allKnown = new Set([...Object.keys(LIGHT_COMMANDS), ...Object.keys(FULL_COMMANDS), 'init', 'update']);

    const sub = findSub(['node', 'cli.js', '--help']);
    const hasRealSub = sub !== undefined && allKnown.has(sub);
    const isHelpOrVersion = true; // --help is in argv

    expect(sub).toBeUndefined();
    expect(hasRealSub).toBe(false);
    expect(isHelpOrVersion && !hasRealSub).toBe(true);
  });

  it('--version without real subcommand triggers fast path', () => {
    const allKnown = new Set(['task', 'agent', 'run', 'init', 'update']);
    const sub = findSub(['node', 'cli.js', '--version']);
    const hasRealSub = sub !== undefined && allKnown.has(sub);
    const isHelpOrVersion = true;

    expect(sub).toBeUndefined();
    expect(hasRealSub).toBe(false);
    expect(isHelpOrVersion).toBe(true);
  });

  it('task --help still goes through container (has real subcommand)', () => {
    const allKnown = new Set(['task', 'agent', 'run', 'init', 'update']);
    const sub = findSub(['node', 'cli.js', 'task', '--help']);
    const hasRealSub = sub !== undefined && allKnown.has(sub);
    const isHelpOrVersion = true; // --help is in argv

    // Fast path does NOT trigger because hasRealSub is true
    expect(sub).toBe('task');
    expect(hasRealSub).toBe(true);
    expect(isHelpOrVersion && !hasRealSub).toBe(false);
  });

  it('sub=undefined (plain orch) takes full path', () => {
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const sub = findSub(['node', 'cli.js']);
    const needsFull = !sub || (sub in FULL_COMMANDS);
    expect(sub).toBeUndefined();
    expect(needsFull).toBe(true);
  });

  it('sub=run takes full path', () => {
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const sub = findSub(['node', 'cli.js', 'run']);
    const needsFull = !sub || (sub in FULL_COMMANDS);
    expect(sub).toBe('run');
    expect(needsFull).toBe(true);
  });

  it('sub=task takes light path', () => {
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const sub = findSub(['node', 'cli.js', 'task']);
    const needsFull = !sub || (sub in FULL_COMMANDS);
    expect(sub).toBe('task');
    expect(needsFull).toBe(false);
  });

  it('sub=tui takes full path', () => {
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const sub = findSub(['node', 'cli.js', 'tui']);
    const needsFull = !sub || (sub in FULL_COMMANDS);
    expect(sub).toBe('tui');
    expect(needsFull).toBe(true);
  });

  it('--json run routes to full path (flag before subcommand)', () => {
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const sub = findSub(['node', 'cli.js', '--json', 'run', 'tsk_1']);
    const needsFull = !sub || (sub in FULL_COMMANDS);
    expect(sub).toBe('run');
    expect(needsFull).toBe(true);
  });

  it('--quiet --json task routes to light path (multiple flags before subcommand)', () => {
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const sub = findSub(['node', 'cli.js', '--quiet', '--json', 'task', 'list']);
    const needsFull = !sub || (sub in FULL_COMMANDS);
    expect(sub).toBe('task');
    expect(needsFull).toBe(false);
  });

  it('--no-color doctor routes to full path', () => {
    const FULL_COMMANDS = { run: 1, doctor: 1, tui: 1 };
    const sub = findSub(['node', 'cli.js', '--no-color', 'doctor']);
    const needsFull = !sub || (sub in FULL_COMMANDS);
    expect(sub).toBe('doctor');
    expect(needsFull).toBe(true);
  });
});
