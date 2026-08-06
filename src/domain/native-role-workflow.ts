export const WORKFLOW_ROLES = ['supervisor', 'adviser', 'implementer', 'reviewer'] as const;
export type WorkflowRole = typeof WORKFLOW_ROLES[number];

export interface WorkflowBinding {
  cli: 'codex' | 'claude';
  model: string;
}

export interface WorkflowAttempt {
  id: string;
  role: WorkflowRole;
  cli: string;
  model: string;
  status: 'started' | 'succeeded' | 'failed' | 'interrupted';
  started_at: string;
  finished_at?: string;
  error?: string;
}

export interface WorkflowCheck {
  command: string;
  status: 'passed' | 'failed';
  output: string;
}

export interface NativeRoleWorkflowState {
  schema_version: 1;
  id: string;
  phase: 'created' | 'running' | 'checking' | 'reviewing' | 'merged' | 'cancelled' | 'failed';
  target_branch: string;
  target_commit: string;
  workflow_branch: string;
  worktree: string;
  roles: {
    supervisor: WorkflowBinding;
    adviser: WorkflowBinding | null;
    implementer: WorkflowBinding;
    reviewer: WorkflowBinding;
  };
  attempts: WorkflowAttempt[];
  checks: WorkflowCheck[];
  implementation_commit: string | null;
  diff_hash: string | null;
  merge_commit: string | null;
  error: string | null;
}

export function validateWorkflowBindings(bindings: NativeRoleWorkflowState['roles']): void {
  if (bindings.supervisor.cli !== 'codex') throw new Error('Supervisor must use the Codex CLI');
  if (bindings.implementer.cli !== 'claude') throw new Error('Implementer must use the Claude CLI');
  if (bindings.reviewer.cli !== 'codex') throw new Error('Reviewer must use the Codex CLI');
  if (bindings.adviser && bindings.adviser.cli !== 'claude') throw new Error('Adviser must use the Claude CLI');
  for (const [role, binding] of Object.entries(bindings)) {
    if (binding && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(binding.model)) {
      throw new Error(`${role} model is invalid`);
    }
  }
}
