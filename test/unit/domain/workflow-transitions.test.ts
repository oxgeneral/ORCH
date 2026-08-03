import { describe, expect, it } from 'vitest';
import { canTransitionWorkflow, transitionWorkflow } from '../../../src/domain/workflow/transitions.js';

describe('workflow transitions', () => {
  it('models explicit execution, review, control, and terminal phases', () => {
    expect(canTransitionWorkflow('codex_brief', 'fable_plan')).toBe(true);
    expect(canTransitionWorkflow('codex_technical_review', 'codex_synthesis')).toBe(true);
    expect(canTransitionWorkflow('codex_technical_review', 'fable_compliance_review')).toBe(true);
    expect(canTransitionWorkflow('merge_ready', 'done')).toBe(true);
    expect(canTransitionWorkflow('done', 'opus_execution')).toBe(false);
  });

  it('has no force-write escape hatch', () => {
    expect(() => transitionWorkflow('codex_brief', 'done')).toThrow('Invalid workflow phase transition');
  });
});
