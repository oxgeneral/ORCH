import { describe, expect, it } from 'vitest';
import { validateWorkflowBindings } from '../../../src/domain/native-role-workflow.js';

const valid = {
  supervisor: { cli: 'codex' as const, model: 'supervisor-model' },
  adviser: null,
  implementer: { cli: 'claude' as const, model: 'implementer-model' },
  reviewer: { cli: 'codex' as const, model: 'reviewer-model' },
};

describe('native role workflow bindings', () => {
  it('accepts the supported direct role path', () => {
    expect(() => validateWorkflowBindings(valid)).not.toThrow();
  });

  it.each([
    ['supervisor', 'claude'],
    ['implementer', 'codex'],
    ['reviewer', 'claude'],
    ['adviser', 'codex'],
  ] as const)('rejects unsupported %s transport', (role, cli) => {
    const bindings = { ...valid, [role]: { cli, model: 'model' } };
    expect(() => validateWorkflowBindings(bindings as typeof valid)).toThrow();
  });

  it('rejects unsafe model arguments', () => {
    expect(() => validateWorkflowBindings({
      ...valid,
      supervisor: { cli: 'codex', model: '--dangerous flag' },
    })).toThrow('supervisor model is invalid');
  });
});
