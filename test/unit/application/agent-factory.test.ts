import { describe, it, expect } from 'vitest';
import { templateToAgentInput, isMcpSkill } from '../../../src/application/agent-factory.js';
import type { AgentShopTemplate } from '../../../src/domain/agent-shop.js';

const baseTemplate: AgentShopTemplate = {
  key: 'test',
  name: 'Test Agent',
  description: 'A test agent',
  tier: 'balanced',
  approval_policy: 'auto',
  skills: ['review', 'careful', 'feature-dev:feature-dev', 'testing-suite:generate-tests'],
  role: 'Test role',
};

describe('isMcpSkill', () => {
  it('returns true for colon-separated skills', () => {
    expect(isMcpSkill('feature-dev:feature-dev')).toBe(true);
    expect(isMcpSkill('testing-suite:generate-tests')).toBe(true);
  });

  it('returns false for library skills', () => {
    expect(isMcpSkill('review')).toBe(false);
    expect(isMcpSkill('careful')).toBe(false);
    expect(isMcpSkill('qa')).toBe(false);
  });
});

describe('templateToAgentInput', () => {
  it('resolves model for claude adapter', () => {
    const input = templateToAgentInput(baseTemplate, 'claude');
    expect(input.adapter).toBe('claude');
    expect(input.model).toBe('claude-sonnet-4-6');
    expect(input.name).toBe('Test Agent');
    expect(input.role).toBe('Test role');
    expect(input.approval_policy).toBe('auto');
  });

  it('resolves model for codex adapter', () => {
    const input = templateToAgentInput(baseTemplate, 'codex');
    expect(input.adapter).toBe('codex');
    expect(input.model).toBe('gpt-5.3-codex');
  });

  it('resolves empty model for shell adapter', () => {
    const input = templateToAgentInput(baseTemplate, 'shell');
    expect(input.adapter).toBe('shell');
    expect(input.model).toBeUndefined(); // empty string → undefined
  });

  it('keeps all skills for claude adapter', () => {
    const input = templateToAgentInput(baseTemplate, 'claude');
    expect(input.skills).toEqual(['review', 'careful', 'feature-dev:feature-dev', 'testing-suite:generate-tests']);
  });

  it('filters MCP skills for non-claude adapters', () => {
    const input = templateToAgentInput(baseTemplate, 'opencode');
    expect(input.skills).toEqual(['review', 'careful']);
  });

  it('filters MCP skills for codex adapter', () => {
    const input = templateToAgentInput(baseTemplate, 'codex');
    expect(input.skills).toEqual(['review', 'careful']);
  });

  it('handles capable tier', () => {
    const capableTemplate: AgentShopTemplate = { ...baseTemplate, tier: 'capable' };
    const input = templateToAgentInput(capableTemplate, 'claude');
    expect(input.model).toBe('claude-opus-4-6');
  });

  it('handles unknown adapter gracefully', () => {
    const input = templateToAgentInput(baseTemplate, 'unknown-adapter');
    expect(input.adapter).toBe('unknown-adapter');
    expect(input.model).toBeUndefined();
  });
});
