/**
 * Integration tests for the ORCH skill library system.
 *
 * Verifies that SkillLoader content is correctly injected into the systemPrompt
 * (or legacy combined prompt) passed to adapter.execute() during dispatchTask().
 *
 * Scenarios covered:
 * 1. Library skills → skill content appended to systemPrompt
 * 2. MCP-only skills (containing ':') → no skill content appended
 * 3. Mixed skills (library + MCP) → only library content appended
 * 4. No skills / undefined skills → systemPrompt unchanged
 * 5. Legacy template mode → skill content appended to combined prompt
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../../../src/application/orchestrator.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter, ExecuteHandle, AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import type { ISkillLoader } from '../../../src/infrastructure/skills/skill-loader.js';
import {
  makeTask,
  makeAgent,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  createMockWorkspaceManager,
  buildDeps,
} from './helpers.js';

// Mock the lock module so tests don't touch the filesystem
vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
  touchLock: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock ISkillLoader that returns predetermined content per skill name. */
function createMockSkillLoader(skillMap: Record<string, string> = {}): ISkillLoader {
  return {
    loadSkills: vi.fn(async (skillNames: string[]) => {
      const librarySkills = skillNames.filter((s) => !s.includes(':'));
      if (librarySkills.length === 0) return '';

      const sections = librarySkills
        .map((name) => {
          const content = skillMap[name];
          return content ? `### ${name}\n\n${content}` : null;
        })
        .filter((s): s is string => s !== null);

      if (sections.length === 0) return '';
      return `## Skills\n\n${sections.join('\n\n')}`;
    }),
    listAvailable: vi.fn(async () => Object.keys(skillMap)),
  };
}

/** Captures the execute() call args from a mock adapter. */
function createCapturingAdapter(): {
  adapter: IAgentAdapter;
  getLastCall: () => { prompt: string; systemPrompt?: string } | null;
} {
  let lastCall: { prompt: string; systemPrompt?: string } | null = null;

  const adapter: IAgentAdapter = {
    kind: 'shell',
    test: vi.fn(async () => ({ ok: true })),
    execute: vi.fn((params): ExecuteHandle => {
      lastCall = { prompt: params.prompt, systemPrompt: params.systemPrompt };
      // Return a fast-completing generator so the run finishes cleanly
      return {
        pid: 11111,
        events: (async function* (): AsyncGenerator<AgentEvent> {
          yield { type: 'output', data: 'done' };
        })(),
      };
    }),
    stop: vi.fn(async () => {}),
  };

  return { adapter, getLastCall: () => lastCall };
}

/** Build a registry with a single capturing adapter registered as 'shell'. */
function buildRegistryWithAdapter(adapter: IAgentAdapter): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(adapter);
  return registry;
}

/** Resolve one tick by waiting a sufficient amount of time for the async loop. */
function waitForDispatch(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator skill injection', () => {
  let orchestrator: Orchestrator;

  afterEach(async () => {
    // Clean up timers and state without calling stop() (which tries to touch
    // the lock file and may race with test teardown)
    const o = orchestrator as any;
    if (o.intervalId) { clearInterval(o.intervalId); o.intervalId = null; }
    if (o.immediateDispatchTimer) { clearTimeout(o.immediateDispatchTimer); o.immediateDispatchTimer = null; }
    if (o.saveStateTimer) { clearTimeout(o.saveStateTimer); o.saveStateTimer = null; }
    o.shuttingDown = true;
    o.removeSignalHandlers?.();
    o.lockAcquired = false;
  });

  // --------------------------------------------------------------------------
  // 1. Library skills — skill content appended to systemPrompt
  // --------------------------------------------------------------------------
  describe('1. Library skill injection into systemPrompt', () => {
    it('appends skill block to systemPrompt when agent has a library skill', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['review'] },
      });

      const skillLoader = createMockSkillLoader({
        review: 'Always review code carefully before marking done.',
      });

      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      // Template engine returns a fixed string so we can assert the suffix
      const templateEngine = {
        render: vi.fn(async (_tpl: string) => 'rendered-system-prompt'),
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call).not.toBeNull();
      expect(call!.systemPrompt).toContain('## Skills');
      expect(call!.systemPrompt).toContain('### review');
      expect(call!.systemPrompt).toContain('Always review code carefully before marking done.');
    });

    it('skillLoader.loadSkills is called with the agent skill list', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['careful', 'review'] },
      });

      const skillLoader = createMockSkillLoader({
        careful: 'Be careful.',
        review: 'Review thoroughly.',
      });

      const { adapter } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      expect(skillLoader.loadSkills).toHaveBeenCalledWith(['careful', 'review']);
    });

    it('skill content is separated from the original systemPrompt by a blank line', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['careful'] },
      });

      const skillLoader = createMockSkillLoader({ careful: 'Be careful.' });
      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async (_tpl: string) => 'SYSTEM_BASE'),
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call!.systemPrompt).toMatch(/SYSTEM_BASE\n\n## Skills/);
    });
  });

  // --------------------------------------------------------------------------
  // 2. MCP-only skills — no skill content appended
  // --------------------------------------------------------------------------
  describe('2. MCP skills are skipped', () => {
    it('does not append any skill block when agent only has MCP skills', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['feature-dev:code-explorer', 'server:memory'] },
      });

      const skillLoader = createMockSkillLoader({});
      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async (_tpl: string) => 'base-system-prompt'),
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call).not.toBeNull();
      // systemPrompt must equal the base rendered value — no skill block added
      expect(call!.systemPrompt).toBe('base-system-prompt');
      expect(call!.systemPrompt).not.toContain('## Skills');
    });

    it('skillLoader.loadSkills still receives MCP skills but returns empty string', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['mcp:toolname'] },
      });

      // Real-like loader: filters out ':' skills and returns ''
      const skillLoader: ISkillLoader = {
        loadSkills: vi.fn(async (names: string[]) => {
          const library = names.filter((s) => !s.includes(':'));
          return library.length === 0 ? '' : '## Skills\n\nshould-not-appear';
        }),
        listAvailable: vi.fn(async () => []),
      };

      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'system-prompt-unchanged'),
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      expect(skillLoader.loadSkills).toHaveBeenCalledWith(['mcp:toolname']);
      const call = getLastCall();
      expect(call!.systemPrompt).toBe('system-prompt-unchanged');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Mixed skills — only library skills appear
  // --------------------------------------------------------------------------
  describe('3. Mixed library and MCP skills', () => {
    it('appends only library skill content when agent has both library and MCP skills', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: {
          approval_policy: 'auto',
          skills: ['review', 'feature-dev:code-explorer', 'careful'],
        },
      });

      const skillLoader = createMockSkillLoader({
        review: 'Review the diff.',
        careful: 'Be careful.',
      });

      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'base'),
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call!.systemPrompt).toContain('### review');
      expect(call!.systemPrompt).toContain('Review the diff.');
      expect(call!.systemPrompt).toContain('### careful');
      expect(call!.systemPrompt).toContain('Be careful.');
      // MCP skill name must NOT appear as a section header
      expect(call!.systemPrompt).not.toContain('### feature-dev:code-explorer');
    });

    it('passes the full mixed skill list to loadSkills (loader decides what to skip)', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: {
          approval_policy: 'auto',
          skills: ['review', 'mcp-server:search'],
        },
      });

      const skillLoader = createMockSkillLoader({ review: 'Review.' });
      const { adapter } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      // The orchestrator passes the raw list; filtering is SkillLoader's job
      expect(skillLoader.loadSkills).toHaveBeenCalledWith(['review', 'mcp-server:search']);
    });
  });

  // --------------------------------------------------------------------------
  // 4. No skills — systemPrompt unchanged
  // --------------------------------------------------------------------------
  describe('4. No skills — systemPrompt unchanged', () => {
    it('does not modify systemPrompt when agent has an empty skills array', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: [] },
      });

      const skillLoader = createMockSkillLoader({ review: 'Review.' });
      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'original-system-prompt'),
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call!.systemPrompt).toBe('original-system-prompt');
      // skillLoader.loadSkills is not called when skills array is empty
      expect(skillLoader.loadSkills).not.toHaveBeenCalled();
    });

    it('does not modify systemPrompt when agent has no skills field (undefined)', async () => {
      const task = makeTask({ status: 'todo' });
      // makeAgent() leaves config.skills undefined by default
      const agent = makeAgent({
        config: { approval_policy: 'auto' },
      });

      const skillLoader = createMockSkillLoader({ review: 'Review.' });
      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'original-system-prompt'),
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call!.systemPrompt).toBe('original-system-prompt');
      expect(skillLoader.loadSkills).not.toHaveBeenCalled();
    });

    it('does not call loadSkills when skillLoader is not provided in deps', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['review'] },
      });

      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'system-prompt-no-loader'),
      };

      // Deliberately omit skillLoader from deps
      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        // skillLoader intentionally absent
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call!.systemPrompt).toBe('system-prompt-no-loader');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Legacy template mode — skill content appended to combined prompt
  // --------------------------------------------------------------------------
  describe('5. Legacy template mode', () => {
    it('appends skill block to combined prompt when config.prompt.template is set', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['review'] },
      });

      const skillLoader = createMockSkillLoader({
        review: 'Always review code carefully.',
      });

      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'legacy-combined-prompt'),
      };

      const baseConfig = buildDeps().config;
      const legacyConfig = {
        ...baseConfig,
        prompt: {
          ...baseConfig.prompt,
          // Set legacy single-template — this puts the orchestrator in legacy mode
          template: '{{ task.description }}',
        },
        scheduling: { ...baseConfig.scheduling, poll_interval_ms: 100_000 },
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
        config: legacyConfig,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call).not.toBeNull();

      // In legacy mode systemPrompt is undefined; skill block goes into prompt
      expect(call!.systemPrompt).toBeUndefined();
      expect(call!.prompt).toContain('## Skills');
      expect(call!.prompt).toContain('### review');
      expect(call!.prompt).toContain('Always review code carefully.');
    });

    it('legacy combined prompt retains original content before the skill block', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['careful'] },
      });

      const skillLoader = createMockSkillLoader({ careful: 'Be careful.' });
      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'LEGACY_BASE_PROMPT'),
      };

      const baseConfig = buildDeps().config;
      const legacyConfig = {
        ...baseConfig,
        prompt: { ...baseConfig.prompt, template: '{{ task.description }}' },
        scheduling: { ...baseConfig.scheduling, poll_interval_ms: 100_000 },
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
        config: legacyConfig,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call!.prompt).toMatch(/LEGACY_BASE_PROMPT\n\n## Skills/);
    });

    it('does not append skills to legacy prompt when all skills are MCP', async () => {
      const task = makeTask({ status: 'todo' });
      const agent = makeAgent({
        config: { approval_policy: 'auto', skills: ['mcp:search'] },
      });

      const skillLoader: ISkillLoader = {
        loadSkills: vi.fn(async (names: string[]) =>
          names.filter((s) => !s.includes(':')).length === 0 ? '' : '## Skills\n\nshould-not-appear',
        ),
        listAvailable: vi.fn(async () => []),
      };

      const { adapter, getLastCall } = createCapturingAdapter();
      const registry = buildRegistryWithAdapter(adapter);

      const templateEngine = {
        render: vi.fn(async () => 'LEGACY_UNCHANGED'),
      };

      const baseConfig = buildDeps().config;
      const legacyConfig = {
        ...baseConfig,
        prompt: { ...baseConfig.prompt, template: '{{ task.description }}' },
        scheduling: { ...baseConfig.scheduling, poll_interval_ms: 100_000 },
      };

      const deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        templateEngine,
        skillLoader,
        config: legacyConfig,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch({ skipAutonomousSeeding: true });
      await waitForDispatch();

      const call = getLastCall();
      expect(call!.prompt).toBe('LEGACY_UNCHANGED');
    });
  });
});
