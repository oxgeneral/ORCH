import type { CheckResults, CodexBrief, CodexPlanReview, CodexSynthesis, CodexTechnicalReview, FableComplianceReview, FablePlan, OpusResult } from '../../domain/workflow/contracts.js';
import type { WorkflowPassportV1 } from '../../domain/workflow/state.js';

export interface RoleUsage { input_tokens?: number; output_tokens?: number; cache_read?: number; cache_write?: number; duration_ms?: number; compactions?: number; }
export interface RoleResult<T> { value: T; session_id?: string; resumed?: boolean; resume_failed?: boolean; usage?: RoleUsage; }
export interface FableCallOptions { workspace: string; max_turns: 1; effort: 'low'; max_input_bytes: number; max_output_bytes: number; }

export interface CodexRolePort {
  brief(passport: WorkflowPassportV1, threadId: string | null): Promise<RoleResult<CodexBrief>>;
  reviewPlan(passport: WorkflowPassportV1, plan: FablePlan, threadId: string | null): Promise<RoleResult<CodexPlanReview>>;
  compileFinalPrompt(passport: WorkflowPassportV1, plan: FablePlan, threadId: string | null): Promise<RoleResult<string>>;
  technicalReview(passport: WorkflowPassportV1, evidence: GitEvidence, checks: CheckResults, threadId: string | null): Promise<RoleResult<CodexTechnicalReview>>;
  synthesize(passport: WorkflowPassportV1, technical: CodexTechnicalReview, compliance: FableComplianceReview | null, checks: CheckResults, threadId: string | null): Promise<RoleResult<CodexSynthesis>>;
  available(): Promise<{ available: boolean; detail: string }>;
}

export interface FableRolePort {
  plan(passport: WorkflowPassportV1, brief: CodexBrief, previous: FablePlan | null, changes: string[], options: FableCallOptions): Promise<RoleResult<FablePlan>>;
  finalPrompt(passport: WorkflowPassportV1, plan: FablePlan, amendments: string[], options: FableCallOptions): Promise<RoleResult<string>>;
  compliance(passport: WorkflowPassportV1, plan: FablePlan, opus: OpusResult, evidence: GitEvidence, checks: CheckResults, options: FableCallOptions): Promise<RoleResult<FableComplianceReview>>;
  available(): Promise<{ available: boolean; detail: string }>;
}

export interface OpusRolePort {
  execute(passport: WorkflowPassportV1, prompt: string, workspace: string, sessionId: string | null, mode: 'new' | 'resume'): Promise<RoleResult<OpusResult>>;
  available(): Promise<{ available: boolean; detail: string }>;
}

export interface GitEvidence { branch: string; worktree: string; commit: string; diff: string; diff_hash: string; files_changed: string[]; insertions: number; deletions: number; risk_signals: string[]; }
export interface WorkflowGitPort {
  prepare(jobId: string): Promise<{ branch: string; worktree: string }>;
  inspect(branch: string, worktree: string): Promise<GitEvidence>;
  runChecks(worktree: string, commit: string, commands: string[]): Promise<CheckResults>;
  currentCommit(branch: string): Promise<string>;
  merge(branch: string): Promise<{ success: boolean; detail: string }>;
}

export interface WorkflowRolePorts { codex: CodexRolePort; fable: FableRolePort; opus: OpusRolePort; git: WorkflowGitPort; }
