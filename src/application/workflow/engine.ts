import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  validateCheckResults, validateCodexBrief, validateCodexPlanReview, validateCodexSynthesis,
  validateCodexTechnicalReview, validateFableComplianceReview, validateFablePlan, validateOpusResult,
  type CheckResults, type CodexBrief, type CodexPlanReview, type CodexTechnicalReview,
  type FableComplianceReview, type FablePlan, type OpusResult,
} from '../../domain/workflow/contracts.js';
import type { AgentUsage, WorkflowConfig, WorkflowJobV1, WorkflowPassportV1, WorkflowSessionsV1 } from '../../domain/workflow/state.js';
import { isTerminalWorkflowPhase, type WorkflowPhase } from '../../domain/workflow/transitions.js';
import { ARTIFACT_FILES, WorkflowArtifactStore, artifactReference, hashCanonical, type ArtifactName, type StoredArtifact } from '../../infrastructure/workflow/artifact-store.js';
import type { FableCallOptions, GitEvidence, RoleResult, WorkflowRolePorts } from './ports.js';

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = { fable_pre_opus_cap: 3, fable_target: 2, max_input_bytes: 128_000, max_output_bytes: 64_000, post_review: 'risk_based', risk_triggers: ['authentication', 'security', 'secret', 'migration', 'deletion', 'billing', 'infrastructure', 'deployment', 'concurrency', 'compliance'] };
export interface StartWorkflowInput { objective: string; allowed_file_scope?: string[]; required_checks?: string[]; config?: Partial<WorkflowConfig>; job_id?: string; }

export class WorkflowEngine {
  constructor(private readonly store: WorkflowArtifactStore, private readonly ports: WorkflowRolePorts) {}

  async start(input: StartWorkflowInput): Promise<string> {
    if (!input.objective.trim()) throw new Error('Workflow objective must not be empty');
    const id = input.job_id ?? `wf_${nanoid(12)}`; const now = new Date().toISOString();
    const config = { ...DEFAULT_WORKFLOW_CONFIG, ...input.config };
    if (config.fable_pre_opus_cap < 1 || config.fable_pre_opus_cap > 3) throw new Error('Fable pre-Opus cap must be between 1 and 3');
    const job: WorkflowJobV1 = { schema_version: 1, job_id: id, phase: 'codex_brief', resume_phase: null, revision: 1, artifact_revision: 0, latest_artifact_hash: null, fable_pre_opus_calls: 0, fable_post_opus_calls: 0, fix_cycles: 0, branch: null, worktree: null, current_commit: null, approved_plan_hash: null, last_verdict: null, blocker: null, next_action: 'Codex creates the implementation brief', created_at: now, updated_at: now };
    const requiredChecks = input.required_checks?.length ? input.required_checks : ['git diff --check'];
    const passport: WorkflowPassportV1 = { schema_version: 1, job_id: id, current_revision: 1, objective: input.objective, current_phase: 'codex_brief', approved_plan_hash: null, acceptance_criteria: [], mandatory_amendments: [], decisions: [], allowed_file_scope: input.allowed_file_scope ?? [], required_checks: requiredChecks, current_blockers: [], next_action: job.next_action, artifacts: [], session_references: { codex: null, opus: null }, config };
    const sessions: WorkflowSessionsV1 = { schema_version: 1, job_id: id, codex_thread_id: null, opus_session_id: null, opus_plan_hash: null, usage: { codex: usage(), fable: usage(), opus: usage() }, updated_at: now };
    await this.store.createJob(job, passport, sessions); await this.event(id, 'workflow_started', { objective: input.objective }); return id;
  }

  async run(jobId: string): Promise<WorkflowJobV1> {
    while (true) {
      const job = await this.requiredJob(jobId);
      if (isTerminalWorkflowPhase(job.phase) || job.phase === 'paused' || job.phase === 'blocked') return job;
      try { await this.step(job); }
      catch (error) { const reason = error instanceof Error ? error.message : String(error); await this.event(jobId, 'workflow_failed', { reason }); return this.store.transition(jobId, 'failed', { blocker: reason, next_action: 'Inspect workflow logs and artifacts' }); }
    }
  }

  async pause(jobId: string): Promise<WorkflowJobV1> { const job = await this.requiredJob(jobId); if (isTerminalWorkflowPhase(job.phase) || job.phase === 'paused') throw new Error(`Cannot pause workflow in ${job.phase}`); return this.transition(job, 'paused', { resume_phase: job.phase, next_action: 'Resume workflow' }); }
  async resume(jobId: string): Promise<WorkflowJobV1> { const job = await this.requiredJob(jobId); if (job.phase !== 'paused' && job.phase !== 'blocked') throw new Error(`Cannot resume workflow in ${job.phase}`); if (!job.resume_phase) throw new Error('Workflow has no recoverable phase'); const resumed = await this.transition(job, job.resume_phase, { blocker: null, resume_phase: null }); await this.event(jobId, 'workflow_resumed', { phase: resumed.phase }); return this.run(jobId); }
  async cancel(jobId: string): Promise<WorkflowJobV1> { const job = await this.requiredJob(jobId); if (isTerminalWorkflowPhase(job.phase)) throw new Error(`Cannot cancel workflow in ${job.phase}`); return this.transition(job, 'cancelled', { next_action: 'No further action' }); }

  private async step(job: WorkflowJobV1): Promise<void> {
    switch (job.phase) {
      case 'codex_brief': return this.codexBrief(job);
      case 'fable_plan': return this.fablePlan(job);
      case 'codex_plan_review': return this.codexPlanReview(job);
      case 'fable_final_prompt': return this.finalPrompt(job);
      case 'opus_execution': return this.opusExecution(job);
      case 'codex_technical_review': return this.technicalReview(job);
      case 'fable_compliance_review': return this.complianceReview(job);
      case 'codex_synthesis': return this.synthesis(job);
      case 'merge_ready': return this.merge(job);
      default: throw new Error(`No workflow action for phase ${job.phase}`);
    }
  }

  private async codexBrief(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); const result = await this.ports.codex.brief(passport, sessions.codex_thread_id); const brief = validateCodexBrief(result.value); this.assertJob(job, brief.job_id);
    await this.recordRole(job.job_id, 'codex', result); const stored = await this.artifact(job, 'codex_brief', 'codex', brief, validateCodexBrief); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_brief);
    await this.transition(await this.requiredJob(job.job_id), 'fable_plan', { next_action: 'Fable creates plan revision 1' });
  }

  private async fablePlan(job: WorkflowJobV1): Promise<void> {
    if (job.fable_pre_opus_calls >= (await this.requiredPassport(job.job_id)).config.fable_pre_opus_cap) return this.block(job, 'Fable pre-Opus call cap reached before an approvable plan');
    const { passport } = await this.context(job.job_id); const brief = await this.payload<CodexBrief>(job, 'codex_brief'); const previous = job.revision > 1 ? await this.optionalPayload<FablePlan>(job, 'fable_plan', job.revision - 1) : null;
    const options = await this.fableOptions(passport); const result = await this.fableCall(options, () => this.ports.fable.plan(passport, brief, previous, passport.mandatory_amendments, options)); this.assertFableOutput(passport, result.value); const plan = validateFablePlan(result.value); this.assertJob(job, plan.job_id); if (plan.revision !== job.revision) throw new Error('Stale Fable plan revision');
    await this.recordRole(job.job_id, 'fable', result); const fresh = await this.store.patchJob(job.job_id, { fable_pre_opus_calls: job.fable_pre_opus_calls + 1 }); const stored = await this.artifact(fresh, 'fable_plan', 'fable', plan, validateFablePlan); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_plan.replace('%REV%', String(job.revision).padStart(3, '0')));
    await this.updatePassport(job.job_id, { acceptance_criteria: plan.acceptance_criteria, current_revision: job.revision }); await this.transition(await this.requiredJob(job.job_id), 'codex_plan_review', { next_action: `Codex reviews plan revision ${job.revision}` });
  }

  private async codexPlanReview(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); const plan = await this.payload<FablePlan>(job, 'fable_plan'); const result = await this.ports.codex.reviewPlan(passport, plan, sessions.codex_thread_id); const review = validateCodexPlanReview(result.value); this.assertJob(job, review.job_id); if (review.revision !== job.revision) throw new Error('Stale Codex plan review revision');
    await this.recordRole(job.job_id, 'codex', result); const stored = await this.artifact(job, 'codex_plan_review', 'codex', review, validateCodexPlanReview); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_plan_review.replace('%REV%', String(job.revision).padStart(3, '0'))); await this.decision(job.job_id, review.verdict, review.concise_reason);
    const fresh = await this.requiredJob(job.job_id);
    if (review.verdict === 'BLOCKED') return this.block(fresh, review.concise_reason);
    if (review.verdict === 'REPLAN') { await this.updatePassport(job.job_id, { mandatory_amendments: review.mandatory_changes }); await this.transition(fresh, 'fable_plan', { revision: job.revision + 1, last_verdict: review.verdict, next_action: `Fable creates plan revision ${job.revision + 1}` }); return; }
    const approvedHash = hashCanonical(plan); await this.updatePassport(job.job_id, { approved_plan_hash: approvedHash, acceptance_criteria: review.acceptance_criteria, mandatory_amendments: review.mandatory_changes }); await this.transition(fresh, 'fable_final_prompt', { approved_plan_hash: approvedHash, last_verdict: review.verdict, next_action: 'Compile final Opus prompt' });
  }

  private async finalPrompt(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); const plan = await this.payload<FablePlan>(job, 'fable_plan'); let result: RoleResult<string>; let role: 'fable' | 'codex';
    if (job.fable_pre_opus_calls < passport.config.fable_pre_opus_cap) { const options = await this.fableOptions(passport); result = await this.fableCall(options, () => this.ports.fable.finalPrompt(passport, plan, passport.mandatory_amendments, options)); this.assertFableOutput(passport, result.value); role = 'fable'; await this.store.patchJob(job.job_id, { fable_pre_opus_calls: job.fable_pre_opus_calls + 1 }); }
    else { result = await this.ports.codex.compileFinalPrompt(passport, plan, sessions.codex_thread_id); role = 'codex'; await this.event(job.job_id, 'fable_cap_fallback', { role: 'codex' }); }
    if (typeof result.value !== 'string' || !result.value.trim()) throw new Error('Final prompt must be non-empty'); await this.recordRole(job.job_id, role, result);
    const fresh = await this.requiredJob(job.job_id); const stored = await this.store.writeTextArtifact({ job_id: job.job_id, name: 'fable_final_prompt', phase: 'fable_final_prompt', revision: fresh.artifact_revision + 1, producing_role: role, parent_artifact_hash: fresh.latest_artifact_hash, payload: result.value }); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_final_prompt);
    let prepared = { branch: fresh.branch, worktree: fresh.worktree }; if (!prepared.branch || !prepared.worktree) prepared = await this.ports.git.prepare(job.job_id);
    await this.transition(await this.requiredJob(job.job_id), 'opus_execution', { branch: prepared.branch, worktree: prepared.worktree, next_action: 'Opus implements in dedicated worktree' });
  }

  private async opusExecution(job: WorkflowJobV1): Promise<void> {
    if (!job.worktree || !job.branch) throw new Error('Opus worktree is missing'); const { passport, sessions } = await this.context(job.job_id); const prompt = await this.textPayload(job, 'fable_final_prompt'); const mode = sessions.opus_session_id && sessions.opus_plan_hash === job.approved_plan_hash ? 'resume' : 'new';
    const result = await this.ports.opus.execute(passport, prompt, job.worktree, mode === 'resume' ? sessions.opus_session_id : null, mode); const opus = validateOpusResult(result.value); this.assertJob(job, opus.job_id); await this.recordRole(job.job_id, 'opus', result, mode === 'resume');
    const stored = await this.artifact(job, 'opus_report', 'opus', opus, validateOpusResult); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.opus_report); if (opus.status === 'failed') throw new Error(`Opus execution failed: ${opus.summary}`);
    const evidence = await this.ports.git.inspect(job.branch, job.worktree); this.assertAllowedScope(passport, evidence.files_changed); const fresh = await this.requiredJob(job.job_id); const diffStored = await this.store.writeTextArtifact({ job_id: job.job_id, name: 'opus_diff', phase: 'opus_execution', revision: fresh.artifact_revision + 1, producing_role: 'orchestrator', parent_artifact_hash: fresh.latest_artifact_hash, payload: evidence.diff || '(empty diff)' }); await this.addArtifact(job.job_id, diffStored, ARTIFACT_FILES.opus_diff);
    await this.transition(await this.requiredJob(job.job_id), 'codex_technical_review', { current_commit: evidence.commit, next_action: 'Run checks and Codex technical review' });
  }

  private async technicalReview(job: WorkflowJobV1): Promise<void> {
    if (!job.branch || !job.worktree) throw new Error('Worktree evidence is missing'); const { passport, sessions } = await this.context(job.job_id); const evidence = await this.ports.git.inspect(job.branch, job.worktree); const checks = validateCheckResults(await this.ports.git.runChecks(job.worktree, evidence.commit, passport.required_checks)); this.assertJob(job, checks.job_id); if (checks.commit !== evidence.commit) throw new Error('Check results are stale');
    let fresh = await this.requiredJob(job.job_id); const checkStored = await this.artifact(fresh, 'test_results', 'orchestrator', checks, validateCheckResults); await this.addArtifact(job.job_id, checkStored, ARTIFACT_FILES.test_results);
    const result = await this.ports.codex.technicalReview(await this.requiredPassport(job.job_id), evidence, checks, sessions.codex_thread_id); const review = validateCodexTechnicalReview(result.value); this.assertJob(job, review.job_id); if (review.reviewed_commit !== evidence.commit) throw new Error('Codex reviewed a stale commit'); await this.recordRole(job.job_id, 'codex', result); fresh = await this.requiredJob(job.job_id); const stored = await this.artifact(fresh, 'codex_technical_review', 'codex', review, validateCodexTechnicalReview); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_technical_review);
    const needsFable = passport.config.post_review === 'always' || (passport.config.post_review === 'risk_based' && this.isRisky(passport, evidence)); await this.transition(await this.requiredJob(job.job_id), needsFable ? 'fable_compliance_review' : 'codex_synthesis', { current_commit: evidence.commit, next_action: needsFable ? 'Fable checks plan compliance' : 'Codex synthesizes evidence' });
  }

  private async complianceReview(job: WorkflowJobV1): Promise<void> {
    const { passport } = await this.context(job.job_id); if (!job.branch || !job.worktree) throw new Error('Worktree evidence is missing'); const plan = await this.payload<FablePlan>(job, 'fable_plan'); const opus = await this.payload<OpusResult>(job, 'opus_report'); const checks = await this.payload<CheckResults>(job, 'test_results'); const evidence = await this.ports.git.inspect(job.branch, job.worktree); if (evidence.commit !== checks.commit) throw new Error('Compliance evidence is stale');
    const options = await this.fableOptions(passport); const result = await this.fableCall(options, () => this.ports.fable.compliance(passport, plan, opus, evidence, checks, options)); this.assertFableOutput(passport, result.value); const review = validateFableComplianceReview(result.value); this.assertJob(job, review.job_id); if (review.approved_plan_hash !== job.approved_plan_hash) throw new Error('Fable compliance review used stale plan'); await this.recordRole(job.job_id, 'fable', result); await this.store.patchJob(job.job_id, { fable_post_opus_calls: job.fable_post_opus_calls + 1 }); const fresh = await this.requiredJob(job.job_id); const stored = await this.artifact(fresh, 'fable_compliance_review', 'fable', review, validateFableComplianceReview); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.fable_compliance_review); await this.transition(await this.requiredJob(job.job_id), 'codex_synthesis', { next_action: 'Codex synthesizes both reviews' });
  }

  private async synthesis(job: WorkflowJobV1): Promise<void> {
    const { passport, sessions } = await this.context(job.job_id); const technical = await this.payload<CodexTechnicalReview>(job, 'codex_technical_review'); const checks = await this.payload<CheckResults>(job, 'test_results'); const compliance = await this.optionalPayload<FableComplianceReview>(job, 'fable_compliance_review'); const result = await this.ports.codex.synthesize(passport, technical, compliance, checks, sessions.codex_thread_id); const synthesis = validateCodexSynthesis(result.value); this.assertJob(job, synthesis.job_id); if (synthesis.reviewed_commit !== technical.reviewed_commit || synthesis.reviewed_commit !== checks.commit) throw new Error('Synthesis reviewed_commit is stale'); await this.recordRole(job.job_id, 'codex', result); const fresh = await this.requiredJob(job.job_id); const stored = await this.artifact(fresh, 'codex_synthesis', 'codex', synthesis, validateCodexSynthesis); await this.addArtifact(job.job_id, stored, ARTIFACT_FILES.codex_synthesis); await this.decision(job.job_id, synthesis.verdict, synthesis.concise_reason); const current = await this.requiredJob(job.job_id);
    if (synthesis.verdict === 'BLOCKED') return this.block(current, synthesis.concise_reason);
    if (synthesis.verdict === 'FIX') { if (job.fix_cycles >= 3) return this.block(current, 'Bounded Opus FIX cycle cap reached'); await this.updatePassport(job.job_id, { mandatory_amendments: synthesis.required_fixes }); await this.transition(current, 'opus_execution', { fix_cycles: job.fix_cycles + 1, last_verdict: 'FIX', next_action: 'Resume Opus session for bounded fixes' }); return; }
    if (synthesis.verdict === 'REPLAN') { const sessionsNow = await this.requiredSessions(job.job_id); await this.store.writeSessions({ ...sessionsNow, opus_session_id: null, opus_plan_hash: null, updated_at: new Date().toISOString() }); await this.updatePassport(job.job_id, { mandatory_amendments: synthesis.required_fixes, approved_plan_hash: null }); await this.transition(current, 'fable_plan', { revision: job.revision + 1, approved_plan_hash: null, last_verdict: 'REPLAN', next_action: 'Create a material replan and new Opus session' }); return; }
    if (!synthesis.merge_allowed || !checks.passed || checks.checks.length === 0 || !technical.checks_passed) throw new Error('DONE merge gate rejected incomplete approval or failed checks'); await this.transition(current, 'merge_ready', { last_verdict: 'DONE', current_commit: synthesis.reviewed_commit, next_action: 'Verify immutable approval and merge' });
  }

  private async merge(job: WorkflowJobV1): Promise<void> {
    if (!job.branch || !job.worktree || !job.current_commit) throw new Error('Merge metadata is missing'); const synthesis = await this.payload<import('../../domain/workflow/contracts.js').CodexSynthesis>(job, 'codex_synthesis'); const checks = await this.payload<CheckResults>(job, 'test_results'); const reviewedDiff = await this.textPayload(job, 'opus_diff'); const [actual, evidence] = await Promise.all([this.ports.git.currentCommit(job.branch), this.ports.git.inspect(job.branch, job.worktree)]);
    if (synthesis.verdict !== 'DONE' || !synthesis.merge_allowed || !checks.passed || checks.checks.length === 0 || synthesis.reviewed_commit !== checks.commit || actual !== synthesis.reviewed_commit || evidence.commit !== synthesis.reviewed_commit || evidence.diff_hash !== hashCanonical(reviewedDiff)) throw new Error('Merge approval is stale or incomplete'); const merged = await this.ports.git.merge(job.branch); if (!merged.success) throw new Error(`Merge failed closed: ${merged.detail}`); await this.transition(job, 'done', { next_action: 'Workflow complete' }); await this.event(job.job_id, 'workflow_done', { commit: actual, diff_hash: evidence.diff_hash });
  }

  private async artifact<T>(job: WorkflowJobV1, name: ArtifactName, role: 'codex' | 'fable' | 'opus' | 'orchestrator', value: unknown, validate: (v: unknown) => T): Promise<StoredArtifact<T>> { const fresh = await this.requiredJob(job.job_id); return this.store.writeArtifact({ job_id: job.job_id, name, phase: fresh.phase, revision: fresh.artifact_revision + 1, producing_role: role, parent_artifact_hash: fresh.latest_artifact_hash, payload: value, validate }); }
  private async payload<T>(job: WorkflowJobV1, name: ArtifactName, revision = job.revision): Promise<T> { const result = await this.store.readArtifact<T>(job.job_id, name, revision); if (!result) throw new Error(`Required artifact missing: ${name}`); return result.payload; }
  private async optionalPayload<T>(job: WorkflowJobV1, name: ArtifactName, revision = job.revision): Promise<T | null> { return (await this.store.readArtifact<T>(job.job_id, name, revision))?.payload ?? null; }
  private async textPayload(job: WorkflowJobV1, name: ArtifactName): Promise<string> { const result = await this.store.readTextArtifact(job.job_id, name, job.revision); if (!result) throw new Error(`Required text artifact missing: ${name}`); return result.payload; }
  private async transition(job: WorkflowJobV1, phase: WorkflowPhase, patch: Partial<WorkflowJobV1> = {}): Promise<WorkflowJobV1> { const updated = await this.store.transition(job.job_id, phase, patch); await this.updatePassport(job.job_id, { current_phase: phase, current_revision: updated.revision, next_action: updated.next_action, current_blockers: updated.blocker ? [updated.blocker] : [] }); await this.event(job.job_id, 'phase_changed', { from: job.phase, to: phase }); return updated; }
  private async block(job: WorkflowJobV1, reason: string): Promise<void> { await this.transition(job, 'blocked', { blocker: reason, resume_phase: job.phase, next_action: 'Provide human input, then resume' }); await this.event(job.job_id, 'workflow_blocked', { reason }); }
  private async addArtifact(jobId: string, stored: StoredArtifact<unknown>, filename: string): Promise<void> { const passport = await this.requiredPassport(jobId); await this.store.writePassport({ ...passport, artifacts: [...passport.artifacts, artifactReference(filename, stored)] }); }
  private async decision(jobId: string, verdict: string, reason: string): Promise<void> { const passport = await this.requiredPassport(jobId); await this.store.writePassport({ ...passport, decisions: [...passport.decisions, { verdict, reason, timestamp: new Date().toISOString() }] }); }
  private async updatePassport(jobId: string, patch: Partial<WorkflowPassportV1>): Promise<void> { const passport = await this.requiredPassport(jobId); await this.store.writePassport({ ...passport, ...patch, schema_version: 1, job_id: passport.job_id }); }
  private async recordRole<T>(jobId: string, role: 'codex' | 'fable' | 'opus', result: RoleResult<T>, forcedResume = false): Promise<void> { const sessions = await this.requiredSessions(jobId); const u = sessions.usage[role]; const nextUsage: AgentUsage = { calls: u.calls + 1, input_tokens: u.input_tokens + (result.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (result.usage?.output_tokens ?? 0), cache_read: u.cache_read + (result.usage?.cache_read ?? 0), cache_write: u.cache_write + (result.usage?.cache_write ?? 0), duration_ms: u.duration_ms + (result.usage?.duration_ms ?? 0), failed_calls: u.failed_calls, resumes: u.resumes + (result.resumed || forcedResume ? 1 : 0), compactions: u.compactions + (result.usage?.compactions ?? 0) }; const job = await this.requiredJob(jobId); const updated: WorkflowSessionsV1 = { ...sessions, codex_thread_id: role === 'codex' ? result.session_id ?? sessions.codex_thread_id : sessions.codex_thread_id, opus_session_id: role === 'opus' ? result.session_id ?? sessions.opus_session_id : sessions.opus_session_id, opus_plan_hash: role === 'opus' ? job.approved_plan_hash : sessions.opus_plan_hash, usage: { ...sessions.usage, [role]: nextUsage }, updated_at: new Date().toISOString() }; await this.store.writeSessions(updated); await this.updatePassport(jobId, { session_references: { codex: updated.codex_thread_id, opus: updated.opus_session_id } }); if (result.resume_failed) await this.event(jobId, 'session_resume_fallback', { role }); }
  private async fableOptions(passport: WorkflowPassportV1): Promise<FableCallOptions> { const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-fable-empty-')); return { workspace, max_turns: 1, effort: 'low', max_input_bytes: passport.config.max_input_bytes, max_output_bytes: passport.config.max_output_bytes }; }
  private async fableCall<T>(options: FableCallOptions, call: () => Promise<T>): Promise<T> { try { return await call(); } finally { await fs.rm(options.workspace, { recursive: true, force: true }); } }
  private assertFableOutput(passport: WorkflowPassportV1, value: unknown): void { if (Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)) > passport.config.max_output_bytes) throw new Error('Fable output exceeded configured maximum'); }
  private assertAllowedScope(passport: WorkflowPassportV1, files: string[]): void { if (passport.allowed_file_scope.length === 0) return; const outside = files.filter((file) => !passport.allowed_file_scope.some((allowed) => file === allowed || file.startsWith(`${allowed.replace(/\/$/, '')}/`))); if (outside.length) throw new Error(`Opus changed files outside approved scope: ${outside.join(', ')}`); }
  private isRisky(passport: WorkflowPassportV1, evidence: GitEvidence): boolean { const text = `${passport.objective} ${evidence.risk_signals.join(' ')}`.toLowerCase(); return passport.config.risk_triggers.some((trigger) => text.includes(trigger.toLowerCase())) || evidence.files_changed.length >= 20; }
  private assertJob(job: WorkflowJobV1, received: string): void { if (received !== job.job_id) throw new Error(`Artifact job_id mismatch: ${received}`); }
  private async context(jobId: string): Promise<{ passport: WorkflowPassportV1; sessions: WorkflowSessionsV1 }> { return { passport: await this.requiredPassport(jobId), sessions: await this.requiredSessions(jobId) }; }
  private async requiredJob(id: string): Promise<WorkflowJobV1> { const value = await this.store.readJob(id); if (!value) throw new Error(`Workflow job not found: ${id}`); return value; }
  private async requiredPassport(id: string): Promise<WorkflowPassportV1> { const value = await this.store.readPassport(id); if (!value) throw new Error(`Workflow passport not found: ${id}`); return value; }
  private async requiredSessions(id: string): Promise<WorkflowSessionsV1> { const value = await this.store.readSessions(id); if (!value) throw new Error(`Workflow sessions not found: ${id}`); return value; }
  private async event(id: string, type: string, data: unknown): Promise<void> { await this.store.appendEvent({ schema_version: 1, job_id: id, type, timestamp: new Date().toISOString(), data }); }
}

function usage(): AgentUsage { return { calls: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 }; }
