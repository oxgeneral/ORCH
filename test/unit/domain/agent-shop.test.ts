import { describe, it, expect } from 'vitest';
import { AGENT_SHOP_TEMPLATES, getShopTemplateByKey } from '../../../src/domain/agent-shop.js';
import type { AgentShopTemplate } from '../../../src/domain/agent-shop.js';
import { getShopWizardSteps, applyShopTemplate, agentWizardToInput, getAgentWizardSteps } from '../../../src/tui/wizardConfigs.js';

describe('Agent Shop catalog', () => {
  it('has 15 templates', () => {
    expect(AGENT_SHOP_TEMPLATES).toHaveLength(15);
  });

  it('every template has required fields', () => {
    for (const t of AGENT_SHOP_TEMPLATES) {
      expect(t.key).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(['capable', 'balanced', 'fast']).toContain(t.tier);
      expect(t.role).toBeTruthy();
      expect(t.skills.length).toBeGreaterThan(0);
      expect(['auto', 'suggest', 'manual']).toContain(t.approval_policy);
    }
  });

  it('all keys are unique', () => {
    const keys = AGENT_SHOP_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('all names are unique', () => {
    const names = AGENT_SHOP_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('getShopTemplateByKey returns correct template', () => {
    const t = getShopTemplateByKey('backend-dev');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Backend Developer');
  });

  it('getShopTemplateByKey returns undefined for unknown key', () => {
    expect(getShopTemplateByKey('nonexistent')).toBeUndefined();
  });

  it('every role prompt contains ## WORKFLOW and ## RULES sections', () => {
    for (const t of AGENT_SHOP_TEMPLATES) {
      expect(t.role).toContain('## WORKFLOW');
      expect(t.role).toContain('## RULES');
    }
  });

  it('capable tier used for complex roles', () => {
    const capable = AGENT_SHOP_TEMPLATES.filter((t) => t.tier === 'capable');
    const keys = capable.map((t) => t.key);
    expect(keys).toContain('code-reviewer');
    expect(keys).toContain('architect');
    expect(keys).toContain('security-auditor');
  });
});

describe('Shop wizard steps', () => {
  it('getShopWizardSteps returns a single select step', () => {
    const steps = getShopWizardSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.id).toBe('shop_template');
    expect(steps[0]!.type).toBe('select');
  });

  it('shop step options match catalog size', () => {
    const steps = getShopWizardSteps();
    expect(steps[0]!.options).toHaveLength(AGENT_SHOP_TEMPLATES.length);
  });

  it('shop step option values are template keys', () => {
    const steps = getShopWizardSteps();
    const keys = steps[0]!.options!.map((o) => o.value);
    const catalogKeys = AGENT_SHOP_TEMPLATES.map((t) => t.key);
    expect(keys).toEqual(catalogKeys);
  });
});

describe('applyShopTemplate', () => {
  const template: AgentShopTemplate = {
    key: 'test-agent',
    name: 'Test Agent',
    description: 'test',
    tier: 'balanced',
    approval_policy: 'suggest',
    skills: ['feature-dev:feature-dev', 'testing-suite:generate-tests'],
    role: 'Test role prompt\n## WORKFLOW\n1) Do stuff\n## RULES\n- Be good',
  };

  it('injects name defaultValue', () => {
    const base = getAgentWizardSteps();
    const result = applyShopTemplate(base, template, 'claude');
    const nameStep = result.find((s) => s.id === 'name');
    expect(nameStep!.defaultValue).toBe('Test Agent');
  });

  it('injects adapter defaultValue from provided adapter', () => {
    const base = getAgentWizardSteps();
    const result = applyShopTemplate(base, template, 'opencode');
    const adapterStep = result.find((s) => s.id === 'adapter');
    expect(adapterStep!.defaultValue).toBe('opencode');
  });

  it('falls back to the adapter default when a tier model is not in the live catalog', () => {
    const base = getAgentWizardSteps();
    const result = applyShopTemplate(base, template, 'claude');
    const modelStep = result.find((s) => s.id === 'model');
    expect(modelStep!.defaultValue).toBe('');
  });

  it('forces role to __custom__', () => {
    const base = getAgentWizardSteps();
    const result = applyShopTemplate(base, template, 'claude');
    const roleStep = result.find((s) => s.id === 'role');
    expect(roleStep!.defaultValue).toBe('__custom__');
  });

  it('injects role prompt into role_custom while preserving conditional visibility', () => {
    const base = getAgentWizardSteps();
    const result = applyShopTemplate(base, template, 'claude');
    const customStep = result.find((s) => s.id === 'role_custom');
    expect(customStep!.defaultValue).toBe(template.role);
    expect(customStep!.skip!({ adapter: 'claude', role: '__custom__' })).toBe(false);
    expect(customStep!.skip!({ adapter: 'shell', role: '__custom__' })).toBe(true);
  });

  it('injects skills as comma-separated string', () => {
    const base = getAgentWizardSteps();
    const result = applyShopTemplate(base, template, 'claude');
    const skillsStep = result.find((s) => s.id === 'skills');
    expect(skillsStep!.defaultValue).toBe('feature-dev:feature-dev, testing-suite:generate-tests');
  });

  it('does not mutate original steps', () => {
    const base = getAgentWizardSteps();
    const nameDefault = base.find((s) => s.id === 'name')!.defaultValue;
    applyShopTemplate(base, template, 'claude');
    expect(base.find((s) => s.id === 'name')!.defaultValue).toBe(nameDefault);
  });
});

describe('agentWizardToInput with skills', () => {
  it('parses comma-separated skills', () => {
    const input = agentWizardToInput({
      name: 'Test',
      adapter: 'claude',
      model: 'claude-sonnet-4-6',
      role: '__custom__',
      role_custom: 'role text',
      skills: 'feature-dev:feature-dev, testing-suite:generate-tests',
    });
    expect(input.skills).toEqual(['feature-dev:feature-dev', 'testing-suite:generate-tests']);
  });

  it('returns undefined skills when empty', () => {
    const input = agentWizardToInput({
      name: 'Test',
      adapter: 'claude',
      role: '',
    });
    expect(input.skills).toBeUndefined();
  });

  it('uses defaultAdapter when adapter not in vals', () => {
    const input = agentWizardToInput({ name: 'Test', role: '' }, 'opencode');
    expect(input.adapter).toBe('opencode');
  });
});
