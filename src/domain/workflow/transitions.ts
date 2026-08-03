export type WorkflowPhase =
  | 'codex_brief' | 'fable_plan' | 'codex_plan_review' | 'fable_final_prompt'
  | 'opus_execution' | 'codex_technical_review' | 'fable_compliance_review'
  | 'codex_synthesis' | 'merge_ready' | 'done' | 'blocked' | 'paused'
  | 'cancelled' | 'failed';

const ACTIVE: WorkflowPhase[] = ['codex_brief', 'fable_plan', 'codex_plan_review', 'fable_final_prompt', 'opus_execution', 'codex_technical_review', 'fable_compliance_review', 'codex_synthesis', 'merge_ready'];

export const WORKFLOW_PHASE_TRANSITIONS: Readonly<Record<WorkflowPhase, readonly WorkflowPhase[]>> = {
  codex_brief: ['fable_plan', 'blocked', 'paused', 'cancelled', 'failed'],
  fable_plan: ['codex_plan_review', 'blocked', 'paused', 'cancelled', 'failed'],
  codex_plan_review: ['fable_plan', 'fable_final_prompt', 'blocked', 'paused', 'cancelled', 'failed'],
  fable_final_prompt: ['opus_execution', 'blocked', 'paused', 'cancelled', 'failed'],
  opus_execution: ['codex_technical_review', 'blocked', 'paused', 'cancelled', 'failed'],
  codex_technical_review: ['fable_compliance_review', 'codex_synthesis', 'paused', 'cancelled', 'failed'],
  fable_compliance_review: ['codex_synthesis', 'paused', 'cancelled', 'failed'],
  codex_synthesis: ['opus_execution', 'fable_plan', 'merge_ready', 'blocked', 'paused', 'cancelled', 'failed'],
  merge_ready: ['done', 'failed', 'paused', 'cancelled'],
  done: [], blocked: ['codex_brief', 'fable_plan', 'codex_plan_review', 'fable_final_prompt', 'opus_execution', 'codex_technical_review', 'fable_compliance_review', 'codex_synthesis', 'merge_ready', 'cancelled'],
  paused: [...ACTIVE, 'blocked', 'cancelled'], cancelled: [], failed: [],
};

export function canTransitionWorkflow(from: WorkflowPhase, to: WorkflowPhase): boolean { return WORKFLOW_PHASE_TRANSITIONS[from].includes(to); }
export function transitionWorkflow(from: WorkflowPhase, to: WorkflowPhase): WorkflowPhase { if (!canTransitionWorkflow(from, to)) throw new Error(`Invalid workflow phase transition: ${from} -> ${to}`); return to; }
export function isTerminalWorkflowPhase(phase: WorkflowPhase): boolean { return phase === 'done' || phase === 'cancelled' || phase === 'failed'; }
