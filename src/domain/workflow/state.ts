import type { ProducingRole } from './contracts.js';
import type { WorkflowPhase } from './transitions.js';

export type PostReviewMode = 'risk_based' | 'always' | 'never';
export interface WorkflowConfig { fable_pre_opus_cap: number; fable_target: number; max_input_bytes: number; max_output_bytes: number; post_review: PostReviewMode; risk_triggers: string[]; }
export interface ArtifactReference { filename: string; hash: string; phase: WorkflowPhase; revision: number; }
export interface WorkflowDecision { verdict: string; reason: string; timestamp: string; }

export interface WorkflowJobV1 {
  schema_version: 1; job_id: string; phase: WorkflowPhase; resume_phase: WorkflowPhase | null;
  revision: number; artifact_revision: number; latest_artifact_hash: string | null;
  fable_pre_opus_calls: number; fable_post_opus_calls: number; fix_cycles: number;
  branch: string | null; worktree: string | null; current_commit: string | null;
  approved_plan_hash: string | null; last_verdict: string | null; blocker: string | null;
  next_action: string; created_at: string; updated_at: string;
}

export interface WorkflowPassportV1 {
  schema_version: 1; job_id: string; current_revision: number; objective: string; current_phase: WorkflowPhase;
  approved_plan_hash: string | null; acceptance_criteria: string[]; mandatory_amendments: string[];
  decisions: WorkflowDecision[]; allowed_file_scope: string[]; required_checks: string[];
  current_blockers: string[]; next_action: string; artifacts: ArtifactReference[];
  session_references: { codex: string | null; opus: string | null }; config: WorkflowConfig;
}

export interface AgentUsage { calls: number; input_tokens: number; output_tokens: number; cache_read: number; cache_write: number; duration_ms: number; failed_calls: number; resumes: number; compactions: number; }
export interface WorkflowSessionsV1 { schema_version: 1; job_id: string; codex_thread_id: string | null; opus_session_id: string | null; opus_plan_hash: string | null; usage: Record<'codex' | 'fable' | 'opus', AgentUsage>; updated_at: string; }
export interface WorkflowArtifactMetadataV1 { schema_version: 1; job_id: string; phase: WorkflowPhase; revision: number; producing_role: ProducingRole; parent_artifact_hash: string | null; timestamp: string; artifact_hash: string; }
export interface WorkflowEventV1 { schema_version: 1; job_id: string; type: string; timestamp: string; data: unknown; }
