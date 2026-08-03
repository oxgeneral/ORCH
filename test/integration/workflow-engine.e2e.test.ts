import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkflowEngine } from '../../src/application/workflow/engine.js';
import type { CodexRolePort, FableCallOptions, FableRolePort, GitEvidence, OpusRolePort, WorkflowGitPort } from '../../src/application/workflow/ports.js';
import type { CheckResults, CodexBrief, CodexPlanReview, CodexSynthesis, CodexTechnicalReview, FableComplianceReview, FablePlan, OpusResult } from '../../src/domain/workflow/contracts.js';
import type { WorkflowPassportV1 } from '../../src/domain/workflow/state.js';
import { WorkflowArtifactStore, hashCanonical } from '../../src/infrastructure/workflow/artifact-store.js';
import { clearEnsuredDirs, closeAllAppendHandles } from '../../src/infrastructure/storage/fs-utils.js';

let root: string; let store: WorkflowArtifactStore; let fakes: Fakes; let engine: WorkflowEngine;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-e2e-')); store = new WorkflowArtifactStore(root); fakes = new Fakes(root); engine = makeEngine(store, fakes); });
afterEach(async () => { closeAllAppendHandles(); clearEnsuredDirs(); await fs.rm(root, { recursive: true, force: true }); });

describe('Codex-Fable-Opus workflow E2E', () => {
  it('runs the complete happy path through both reviews and strict merge', async () => {
    const id = await engine.start({ objective: 'security workflow', required_checks: ['test'] }); const result = await engine.run(id);
    expect(result.phase, result.blocker ?? undefined).toBe('done'); expect(fakes.merges).toBe(1); expect(fakes.mergeBeforeDoneApproval).toBe(false); expect(result.fable_pre_opus_calls).toBe(2); expect(result.fable_post_opus_calls).toBe(1);
    const passport = await store.readPassport(id); expect(passport?.artifacts.map((a) => a.filename)).toEqual(expect.arrayContaining(['codex-brief.json', 'fable-plan-r001.json', 'codex-plan-review-r001.json', 'fable-final-prompt.md', 'opus-report.json', 'opus.diff', 'test-results.json', 'codex-technical-review.json', 'fable-compliance-review.json', 'codex-synthesis.json']));
    expect(fakes.fableOptions.every((o) => o.max_turns === 1 && o.effort === 'low' && !o.workspace.startsWith(root))).toBe(true);
  });

  it('applies GO_WITH_PATCH without another Codex plan review', async () => {
    fakes.planVerdicts = ['GO_WITH_PATCH']; const id = await engine.start({ objective: 'small docs', config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.codexPlanReviews).toBe(1); expect(fakes.finalAmendments).toEqual(['bounded patch']);
  });

  it('rejects material patch output at runtime', async () => {
    fakes.materialPatch = true; fakes.planVerdicts = ['GO_WITH_PATCH']; const id = await engine.start({ objective: 'x' }); const result = await engine.run(id); expect(result.phase).toBe('failed'); expect(fakes.opusCalls).toBe(0); expect(fakes.merges).toBe(0);
  });

  it('bounds REPLAN and uses Codex final-prompt fallback at the cap', async () => {
    fakes.planVerdicts = ['REPLAN', 'REPLAN', 'GO']; const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); const result = await engine.run(id); expect(result.phase).toBe('done'); expect(result.fable_pre_opus_calls).toBe(3); expect(fakes.codexPromptFallbacks).toBe(1);
  });

  it('does not retry a failed Fable call', async () => {
    fakes.failFable = true; const id = await engine.start({ objective: 'x' }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.fablePlanCalls).toBe(1);
  });

  it.each([['always', false, 1], ['never', true, 0], ['risk_based', false, 0], ['risk_based', true, 1]] as const)('honors %s post-review with risk=%s', async (mode, risky, expected) => {
    fakes.risky = risky; const id = await engine.start({ objective: 'plain change', config: { post_review: mode } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.complianceCalls).toBe(expected);
  });

  it('resumes the same Opus session for FIX', async () => {
    fakes.synthesisVerdicts = ['FIX', 'DONE']; const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.opusModes).toEqual(['new', 'resume']); expect(fakes.opusSessionInputs).toEqual([null, 'opus-session-1']);
  });

  it('starts a new Opus session after material REPLAN', async () => {
    fakes.synthesisVerdicts = ['REPLAN', 'DONE']; const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.opusModes).toEqual(['new', 'new']); expect((await store.readJob(id))?.revision).toBe(2);
  });

  it('recovers persisted phase and sessions in a new engine', async () => {
    const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); await engine.pause(id); const restarted = makeEngine(new WorkflowArtifactStore(root), fakes); expect((await restarted.resume(id)).phase).toBe('done'); expect((await store.readSessions(id))?.codex_thread_id).toBe('codex-thread');
  });

  it('waits at the join barrier until the selected compliance review exists', async () => {
    const id = await engine.start({ objective: 'security', config: { post_review: 'always' } }); expect((await engine.run(id)).phase).toBe('done'); expect(fakes.synthesisSawCompliance).toBe(true); expect(fakes.sequence.indexOf('compliance')).toBeLessThan(fakes.sequence.indexOf('synthesis'));
  });

  it('never merges before DONE or when checks fail', async () => {
    fakes.checksPass = false; const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.merges).toBe(0);
  });

  it('invalidates approval if the branch commit changes', async () => {
    fakes.staleAtMerge = true; const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.merges).toBe(0);
  });

  it('invalidates approval if the reviewed diff changes', async () => {
    fakes.staleDiffAtMerge = true; const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.merges).toBe(0);
  });

  it('fails closed on merge failure', async () => {
    fakes.mergeFails = true; const id = await engine.start({ objective: 'x', config: { post_review: 'never' } }); expect((await engine.run(id)).phase).toBe('failed'); expect(fakes.merges).toBe(1);
  });
});

class Fakes implements CodexRolePort, FableRolePort, OpusRolePort, WorkflowGitPort {
  planVerdicts: CodexPlanReview['verdict'][] = ['GO']; synthesisVerdicts: CodexSynthesis['verdict'][] = ['DONE']; materialPatch = false; failFable = false; risky = true; checksPass = true; staleAtMerge = false; staleDiffAtMerge = false; mergeFails = false;
  revision = 1; commitIndex = 1; current = 'abcdef1'; codexPlanReviews = 0; codexPromptFallbacks = 0; fablePlanCalls = 0; complianceCalls = 0; opusCalls = 0; merges = 0; mergeBeforeDoneApproval = false; synthesisSawCompliance = false;
  fableOptions: FableCallOptions[] = []; finalAmendments: string[] = []; opusModes: string[] = []; opusSessionInputs: Array<string | null> = []; sequence: string[] = [];
  constructor(private root: string) {}
  async available() { return { available: true, detail: 'fake' }; }
  async brief(p: WorkflowPassportV1): Promise<{ value: CodexBrief; session_id: string }> { return { value: { job_id: p.job_id, objective: p.objective, constraints: [], allowed_file_scope: p.allowed_file_scope, required_checks: p.required_checks }, session_id: 'codex-thread' }; }
  async plan(p: WorkflowPassportV1, _b: CodexBrief, _previous: FablePlan | null, _changes: string[], options: FableCallOptions) { this.fablePlanCalls++; this.fableOptions.push(options); if (this.failFable) throw new Error('fable failed once'); return { value: plan(p) }; }
  async reviewPlan(p: WorkflowPassportV1, value: FablePlan) { this.codexPlanReviews++; const verdict = this.planVerdicts.shift() ?? 'GO'; return { value: { job_id: p.job_id, revision: value.revision, verdict, material_change: this.materialPatch, mandatory_changes: verdict === 'GO_WITH_PATCH' ? ['bounded patch'] : verdict === 'REPLAN' ? ['replan'] : [], acceptance_criteria: value.acceptance_criteria, concise_reason: verdict, next_phase: 'next' } as CodexPlanReview, session_id: 'codex-thread', resumed: true }; }
  async finalPrompt(_p: WorkflowPassportV1, _plan: FablePlan, amendments: string[], options: FableCallOptions) { this.finalAmendments = amendments; this.fableOptions.push(options); return { value: 'Implement approved plan' }; }
  async compileFinalPrompt() { this.codexPromptFallbacks++; return { value: 'Codex fallback prompt', session_id: 'codex-thread' }; }
  async prepare(id: string) { const worktree = path.join(this.root, 'worktree', id); await fs.mkdir(worktree, { recursive: true }); return { branch: `branch/${id}`, worktree }; }
  async execute(p: WorkflowPassportV1, _prompt: string, _workspace: string, session: string | null, mode: 'new' | 'resume') { this.opusCalls++; this.opusModes.push(mode); this.opusSessionInputs.push(session); this.current = `abcdef${++this.commitIndex}`; return { value: { job_id: p.job_id, status: 'completed', files_changed: ['src/x.ts'], commands_run: ['test'], tests_reported: ['pass'], deviations: [], unresolved: [], summary: 'done' } as OpusResult, session_id: mode === 'new' ? `opus-session-${this.opusCalls}` : session ?? undefined, resumed: mode === 'resume' }; }
  async inspect(branch: string, worktree: string): Promise<GitEvidence> { const changed = this.staleDiffAtMerge && this.sequence.at(-1) === 'synthesis'; return { branch, worktree, commit: this.current, diff: changed ? 'changed diff' : 'full diff', diff_hash: changed ? 'b'.repeat(64) : hashCanonical('full diff'), files_changed: ['src/x.ts'], insertions: 2, deletions: 1, risk_signals: this.risky ? ['security'] : [] }; }
  async runChecks(worktree: string, commit: string): Promise<CheckResults> { return { job_id: path.basename(worktree), commit, passed: this.checksPass, checks: [{ command: 'test', passed: this.checksPass, output: 'complete output' }] }; }
  async technicalReview(p: WorkflowPassportV1, evidence: GitEvidence, checks: CheckResults) { this.sequence.push('technical'); return { value: { job_id: p.job_id, reviewed_commit: evidence.commit, checks_passed: checks.passed, evidence: ['diff'], required_fixes: [], concise_reason: 'reviewed' } as CodexTechnicalReview, session_id: 'codex-thread', resumed: true }; }
  async compliance(p: WorkflowPassportV1, _plan: FablePlan, _opus: OpusResult, _evidence: GitEvidence, _checks: CheckResults, options: FableCallOptions) { this.complianceCalls++; this.sequence.push('compliance'); this.fableOptions.push(options); return { value: { job_id: p.job_id, approved_plan_hash: p.approved_plan_hash!, verdict: 'ALIGNED', plan_deviations: [], missing_requirements: [], recommended_repairs: [] } as FableComplianceReview }; }
  async synthesize(p: WorkflowPassportV1, technical: CodexTechnicalReview, compliance: FableComplianceReview | null, checks: CheckResults) { this.sequence.push('synthesis'); this.synthesisSawCompliance = compliance !== null; const verdict = this.synthesisVerdicts.shift() ?? 'DONE'; const done = verdict === 'DONE'; return { value: { job_id: p.job_id, reviewed_commit: technical.reviewed_commit, verdict, merge_allowed: done && checks.passed, evidence: [], required_fixes: verdict === 'FIX' || verdict === 'REPLAN' ? ['repair'] : [], concise_reason: verdict } as CodexSynthesis, session_id: 'codex-thread', resumed: true }; }
  async currentCommit() { return this.staleAtMerge ? 'fffffff' : this.current; }
  async merge() { this.merges++; this.mergeBeforeDoneApproval = this.sequence.at(-1) !== 'synthesis'; return this.mergeFails ? { success: false, detail: 'conflict' } : { success: true, detail: 'merged' }; }
}

function plan(p: WorkflowPassportV1): FablePlan { return { job_id: p.job_id, revision: p.current_revision, assumptions: [], acceptance_criteria: ['works'], implementation_steps: ['implement'], risks: [], questions_requiring_human: [] }; }
function makeEngine(workflowStore: WorkflowArtifactStore, fake: Fakes): WorkflowEngine { return new WorkflowEngine(workflowStore, { codex: fake, fable: fake, opus: fake, git: fake }); }
