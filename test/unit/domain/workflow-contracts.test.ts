import { describe, expect, it } from 'vitest';
import { validateCodexPlanReview, validateCodexSynthesis, validateFablePlan, validateOpusResult } from '../../../src/domain/workflow/contracts.js';

describe('workflow contracts', () => {
  it('requires the exact Fable plan fields', () => {
    expect(validateFablePlan({ job_id: 'wf_1', revision: 1, assumptions: [], acceptance_criteria: ['passes'], implementation_steps: ['build'], risks: [], questions_requiring_human: [] }).revision).toBe(1);
    expect(() => validateFablePlan({ job_id: 'wf_1', revision: 1, assumptions: [], acceptance_criteria: [], implementation_steps: [], risks: [], questions_requiring_human: [], prose: 'extra' })).toThrow('unknown field prose');
  });

  it('supports all required Opus statuses and rejects malformed output', () => {
    for (const status of ['completed', 'partial', 'failed'] as const) expect(validateOpusResult({ job_id: 'wf_1', status, files_changed: [], commands_run: [], tests_reported: [], deviations: [], unresolved: [], summary: status }).status).toBe(status);
    expect(() => validateOpusResult({ job_id: 'wf_1', status: 'done' })).toThrow();
  });

  it('rejects a material GO_WITH_PATCH and unsafe synthesis', () => {
    expect(() => validateCodexPlanReview({ job_id: 'wf_1', revision: 1, verdict: 'GO_WITH_PATCH', material_change: true, mandatory_changes: ['change API'], acceptance_criteria: [], concise_reason: 'material', next_phase: 'x' })).toThrow('use REPLAN');
    expect(() => validateCodexSynthesis({ job_id: 'wf_1', reviewed_commit: 'abcdef1', verdict: 'FIX', merge_allowed: true, evidence: [], required_fixes: [], concise_reason: 'x' })).toThrow('requires DONE');
  });
});
