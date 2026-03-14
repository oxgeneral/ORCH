import { describe, it, expect, vi } from 'vitest';
import {
  LiquidTemplateEngine,
  buildPromptContext,
  filterRelevantContext,
  DEFAULT_PROMPT_TEMPLATE,
  type RetryContext,
} from '../../../src/infrastructure/template/template-engine.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_test1',
    title: 'Test task',
    description: 'Do something',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_test1',
    name: 'test-agent',
    adapter: 'claude',
    config: {
      approval_policy: 'suggest',
      max_turns: 50,
      timeout_ms: 3600000,
      stall_timeout_ms: 300000,
    },
    status: 'idle',
    stats: {
      tasks_completed: 0,
      tasks_failed: 0,
      total_runs: 0,
      total_runtime_ms: 0,
    },
    ...overrides,
  };
}

describe('buildPromptContext', () => {
  it('should not include retry context on first attempt', () => {
    const ctx = buildPromptContext(
      makeTask(),
      makeAgent(),
      1,
      '/workspace',
      DEFAULT_CONFIG,
    );

    expect(ctx.attempt).toBeNull();
    expect(ctx.retry).toBeUndefined();
  });

  it('should include retry context on attempt > 1 when retryContext provided', () => {
    const retryContext: RetryContext = {
      previous_error: 'Process crashed',
      previous_output: 'some output\nmore output',
    };

    const ctx = buildPromptContext(
      makeTask(),
      makeAgent(),
      2,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [], retryContext },
    );

    expect(ctx.attempt).toBe(2);
    expect(ctx.retry).toEqual(retryContext);
  });

  it('should not include retry context on attempt > 1 when retryContext is undefined', () => {
    const ctx = buildPromptContext(
      makeTask(),
      makeAgent(),
      2,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [] },
    );

    expect(ctx.attempt).toBe(2);
    expect(ctx.retry).toBeUndefined();
  });

  it('should ignore retryContext on first attempt even if provided', () => {
    const retryContext: RetryContext = {
      previous_error: 'Some error',
      previous_output: 'output',
    };

    const ctx = buildPromptContext(
      makeTask(),
      makeAgent(),
      1,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [], retryContext },
    );

    expect(ctx.attempt).toBeNull();
    expect(ctx.retry).toBeUndefined();
  });
});

describe('buildPromptContext compact team listing', () => {
  const multilineRole = 'Senior Backend Developer\n## WORKFLOW\n1) Step one\n2) Step two\n## RULES\n- Rule A\n- Rule B';
  const longFirstLine = 'A'.repeat(100);

  it('truncates other agents role to first line', () => {
    const current = makeAgent({ id: 'agt_me', name: 'Me', role: 'My full role' });
    const other = makeAgent({ id: 'agt_other', name: 'Other', role: multilineRole });

    const ctx = buildPromptContext(
      makeTask(),
      current,
      1,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [current, other] },
    );

    const otherInCtx = ctx.agents.find((a) => a.id === 'agt_other')!;
    expect(otherInCtx.role).toBe('Senior Backend Developer');
    expect(otherInCtx.role).not.toContain('WORKFLOW');
  });

  it('truncates first line longer than 80 chars with ellipsis', () => {
    const other = makeAgent({ id: 'agt_long', name: 'Long', role: longFirstLine });
    const current = makeAgent({ id: 'agt_me', name: 'Me' });

    const ctx = buildPromptContext(
      makeTask(),
      current,
      1,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [current, other] },
    );

    const longInCtx = ctx.agents.find((a) => a.id === 'agt_long')!;
    expect(longInCtx.role!.length).toBe(80);
    expect(longInCtx.role).toMatch(/\.\.\.$/);
  });

  it('excludes current agent role from team listing', () => {
    const current = makeAgent({ id: 'agt_me', name: 'Me', role: multilineRole });

    const ctx = buildPromptContext(
      makeTask(),
      current,
      1,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [current] },
    );

    const meInCtx = ctx.agents.find((a) => a.id === 'agt_me')!;
    expect(meInCtx.role).toBeUndefined();
  });

  it('preserves undefined role', () => {
    const other = makeAgent({ id: 'agt_norole', name: 'NoRole', role: undefined });
    const current = makeAgent({ id: 'agt_me', name: 'Me' });

    const ctx = buildPromptContext(
      makeTask(),
      current,
      1,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [current, other] },
    );

    const noRoleInCtx = ctx.agents.find((a) => a.id === 'agt_norole')!;
    expect(noRoleInCtx.role).toBeUndefined();
  });

  it('keeps short single-line role as-is', () => {
    const other = makeAgent({ id: 'agt_short', name: 'Short', role: 'QA Engineer' });
    const current = makeAgent({ id: 'agt_me', name: 'Me' });

    const ctx = buildPromptContext(
      makeTask(),
      current,
      1,
      '/workspace',
      DEFAULT_CONFIG,
      { allAgents: [current, other] },
    );

    const shortInCtx = ctx.agents.find((a) => a.id === 'agt_short')!;
    expect(shortInCtx.role).toBe('QA Engineer');
  });
});

describe('LiquidTemplateEngine timeout', () => {
  it('renders normally within timeout', async () => {
    const engine = new LiquidTemplateEngine({ renderTimeoutMs: 5000 });
    const ctx = buildPromptContext(
      makeTask(),
      makeAgent(),
      1,
      '/workspace',
      DEFAULT_CONFIG,
    );
    const result = await engine.render('Hello {{ agent.name }}', ctx);
    expect(result).toBe('Hello test-agent');
  });

  it('accepts default constructor (no options)', () => {
    const engine = new LiquidTemplateEngine();
    expect(engine).toBeDefined();
  });

  it('disables timeout when renderTimeoutMs is 0', async () => {
    const engine = new LiquidTemplateEngine({ renderTimeoutMs: 0 });
    const ctx = buildPromptContext(
      makeTask(),
      makeAgent(),
      1,
      '/workspace',
      DEFAULT_CONFIG,
    );
    const result = await engine.render('Hello {{ agent.name }}', ctx);
    expect(result).toBe('Hello test-agent');
  });
});

describe('LiquidTemplateEngine with retry context', () => {
  const engine = new LiquidTemplateEngine();

  it('should render retry section when retry context is present', async () => {
    const ctx = buildPromptContext(
      makeTask(),
      makeAgent({ name: 'Backend A', role: 'developer' }),
      2,
      '/workspace',
      DEFAULT_CONFIG,
      {
        allAgents: [],
        retryContext: {
          previous_error: 'npm test failed with exit code 1',
          previous_output: 'FAIL src/app.test.ts\nError: assertion failed',
        },
      },
    );

    const result = await engine.render(DEFAULT_PROMPT_TEMPLATE, ctx);

    expect(result).toContain('Previous attempt failed');
    expect(result).toContain('npm test failed with exit code 1');
    expect(result).toContain('FAIL src/app.test.ts');
    expect(result).toContain('Do NOT repeat the same steps');
    expect(result).toContain('Attempt: 2');
  });

  it('should not render retry section on first attempt', async () => {
    const ctx = buildPromptContext(
      makeTask(),
      makeAgent({ name: 'Backend A' }),
      1,
      '/workspace',
      DEFAULT_CONFIG,
    );

    const result = await engine.render(DEFAULT_PROMPT_TEMPLATE, ctx);

    expect(result).not.toContain('Previous attempt failed');
    expect(result).not.toContain('previous_error');
  });

  it('should render retry section without output when output is empty', async () => {
    const ctx = buildPromptContext(
      makeTask(),
      makeAgent({ name: 'Backend A' }),
      3,
      '/workspace',
      DEFAULT_CONFIG,
      {
        allAgents: [],
        retryContext: {
          previous_error: 'Agent stalled',
          previous_output: '',
        },
      },
    );

    const result = await engine.render(DEFAULT_PROMPT_TEMPLATE, ctx);

    expect(result).toContain('Previous attempt failed');
    expect(result).toContain('Agent stalled');
    expect(result).toContain('Attempt: 3');
    // Empty output should not render "Last output" block
    expect(result).not.toContain('Last output');
  });
});

describe('filterRelevantContext', () => {
  it('returns empty object for empty context', () => {
    const result = filterRelevantContext({}, { agentName: 'Backend A' });
    expect(result).toEqual({});
  });

  it('prioritizes goal_id prefix match', () => {
    const ctx: Record<string, string> = {
      'goal_abc-progress': 'done 3/5 tasks',
      'unrelated-key': 'some value',
      'other-goal-key': 'other value',
    };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A', goalId: 'goal_abc' });
    const keys = Object.keys(result);
    expect(keys[0]).toBe('goal_abc-progress');
  });

  it('prioritizes agent name match in key', () => {
    const ctx: Record<string, string> = {
      'backend-a-status': 'ready',
      'qa-status': 'waiting',
    };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A' });
    const keys = Object.keys(result);
    // backend a matches agent name, should be first
    expect(keys[0]).toBe('backend-a-status');
  });

  it('matches agent name in value', () => {
    const ctx: Record<string, string> = {
      'some-result': 'Backend A completed the fix',
      'other-result': 'QA passed all tests',
    };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A' });
    const keys = Object.keys(result);
    expect(keys[0]).toBe('some-result');
  });

  it('matches scope paths', () => {
    const ctx: Record<string, string> = {
      'tui-fix': 'fixed TUI rendering',
      'api-refactor': 'refactored src/api endpoints',
    };
    const result = filterRelevantContext(ctx, {
      agentName: 'Backend A',
      taskScope: ['src/api/**'],
    });
    const keys = Object.keys(result);
    expect(keys[0]).toBe('api-refactor');
  });

  it('matches role-prefix keywords', () => {
    const ctx: Record<string, string> = {
      'backend-dedup-done': 'dedup completed',
      'frontend-fix': 'UI fix applied',
      'qa-result': 'tests passed',
    };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A' });
    const keys = Object.keys(result);
    expect(keys[0]).toBe('backend-dedup-done');
  });

  it('limits to MAX_CONTEXT_ENTRIES (15)', () => {
    const ctx: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      ctx[`key-${i}`] = `value-${i}`;
    }
    const result = filterRelevantContext(ctx, { agentName: 'Backend A' });
    expect(Object.keys(result).length).toBeLessThanOrEqual(15);
  });

  it('truncates values longer than 500 chars', () => {
    const longValue = 'x'.repeat(600);
    const ctx: Record<string, string> = {
      'long-entry': longValue,
    };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A' });
    expect(result['long-entry']!.length).toBe(500);
    expect(result['long-entry']).toMatch(/…$/);
  });

  it('does not truncate values under 500 chars', () => {
    const shortValue = 'short value';
    const ctx: Record<string, string> = {
      'short-entry': shortValue,
    };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A' });
    expect(result['short-entry']).toBe(shortValue);
  });

  it('respects custom maxValueLength from filter input', () => {
    const longValue = 'y'.repeat(300);
    const ctx: Record<string, string> = { 'entry': longValue };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A', maxValueLength: 200 });
    expect(result['entry']!.length).toBe(200);
    expect(result['entry']).toMatch(/…$/);
  });

  it('does not truncate when value is under custom maxValueLength', () => {
    const ctx: Record<string, string> = { 'entry': 'short' };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A', maxValueLength: 200 });
    expect(result['entry']).toBe('short');
  });

  it('buildPromptContext passes config max_context_value_length to filter', () => {
    const longValue = 'z'.repeat(400);
    const ctx: Record<string, string> = { 'test-key': longValue };
    const configWithLimit = {
      ...DEFAULT_CONFIG,
      prompt: { max_context_value_length: 250 },
    };
    const result = buildPromptContext(
      makeTask(),
      makeAgent({ name: 'Backend A' }),
      1,
      '/workspace',
      configWithLimit,
      { sharedContext: ctx },
    );
    expect(result.shared_context!['test-key']!.length).toBe(250);
    expect(result.shared_context!['test-key']).toMatch(/…$/);
  });

  it('includes zero-score entries when under limit', () => {
    const ctx: Record<string, string> = {
      'random-key-1': 'value1',
      'random-key-2': 'value2',
    };
    const result = filterRelevantContext(ctx, { agentName: 'Backend A' });
    expect(Object.keys(result).length).toBe(2);
  });

  it('front-end agent matches tui- and frontend- prefixes', () => {
    const ctx: Record<string, string> = {
      'tui-fix': 'TUI fix applied',
      'frontend-design': 'new design',
      'backend-status': 'ready',
    };
    const result = filterRelevantContext(ctx, { agentName: 'Front-End' });
    const keys = Object.keys(result);
    // tui- and frontend- should score higher than backend-
    expect(keys.indexOf('tui-fix')).toBeLessThan(keys.indexOf('backend-status'));
    expect(keys.indexOf('frontend-design')).toBeLessThan(keys.indexOf('backend-status'));
  });

  it('buildPromptContext applies filtering to shared_context', () => {
    const ctx: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      ctx[`unrelated-${i}`] = 'x'.repeat(600);
    }
    ctx['goal_test-progress'] = 'goal progress';

    const result = buildPromptContext(
      makeTask({ goalId: 'goal_test' }),
      makeAgent({ name: 'Backend A' }),
      1,
      '/workspace',
      DEFAULT_CONFIG,
      { sharedContext: ctx },
    );

    // Should be filtered and truncated
    expect(Object.keys(result.shared_context!).length).toBeLessThanOrEqual(15);
    // Goal context should be prioritized
    expect(result.shared_context!['goal_test-progress']).toBe('goal progress');
    // Long values should be truncated
    const unrelatedKey = Object.keys(result.shared_context!).find((k) => k.startsWith('unrelated-'));
    if (unrelatedKey) {
      expect(result.shared_context![unrelatedKey]!.length).toBeLessThanOrEqual(500);
    }
  });

  it('boosts bug-/perf-/docs- prefix entries slightly', () => {
    const ctx: Record<string, string> = {
      'bug-123': 'critical bug found',
      'perf-baseline': 'CLI 40ms',
      'random-stuff': 'nothing relevant',
    };
    const result = filterRelevantContext(ctx, { agentName: 'Reviewer' });
    const keys = Object.keys(result);
    // bug- and perf- should come before random-stuff
    expect(keys.indexOf('bug-123')).toBeLessThan(keys.indexOf('random-stuff'));
    expect(keys.indexOf('perf-baseline')).toBeLessThan(keys.indexOf('random-stuff'));
  });
});
