import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkflowArtifactStore } from '../../../src/infrastructure/workflow/artifact-store.js';
import type { WorkflowJobV1, WorkflowPassportV1, WorkflowSessionsV1 } from '../../../src/domain/workflow/state.js';
import { clearEnsuredDirs, closeAllAppendHandles } from '../../../src/infrastructure/storage/fs-utils.js';
import { validateCodexBrief } from '../../../src/domain/workflow/contracts.js';

let root: string; let store: WorkflowArtifactStore;
const now = '2026-08-03T10:00:00.000Z';
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-store-')); store = new WorkflowArtifactStore(root); await create(); });
afterEach(async () => { closeAllAppendHandles(); clearEnsuredDirs(); await fs.rm(root, { recursive: true, force: true }); });

async function create() {
  const job: WorkflowJobV1 = { schema_version: 1, job_id: 'wf_safe', phase: 'codex_brief', resume_phase: null, revision: 1, artifact_revision: 0, latest_artifact_hash: null, fable_pre_opus_calls: 0, fable_post_opus_calls: 0, fix_cycles: 0, branch: null, worktree: null, current_commit: null, approved_plan_hash: null, last_verdict: null, blocker: null, next_action: 'brief', created_at: now, updated_at: now };
  const passport: WorkflowPassportV1 = { schema_version: 1, job_id: 'wf_safe', current_revision: 1, objective: 'build', current_phase: 'codex_brief', approved_plan_hash: null, acceptance_criteria: [], mandatory_amendments: [], decisions: [], allowed_file_scope: [], required_checks: [], current_blockers: [], next_action: 'brief', artifacts: [], session_references: { codex: null, opus: null }, config: { fable_pre_opus_cap: 3, fable_target: 2, max_input_bytes: 1000, max_output_bytes: 1000, post_review: 'never', risk_triggers: [] } };
  const empty = { calls: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, duration_ms: 0, failed_calls: 0, resumes: 0, compactions: 0 };
  const sessions: WorkflowSessionsV1 = { schema_version: 1, job_id: 'wf_safe', codex_thread_id: null, opus_session_id: null, opus_plan_hash: null, usage: { codex: { ...empty }, fable: { ...empty }, opus: { ...empty } }, updated_at: now };
  await store.createJob(job, passport, sessions);
}

describe('WorkflowArtifactStore', () => {
  it('uses exact names, complete canonical content, hashes, and secure modes', async () => {
    const huge = 'x'.repeat(30_000); const stored = await store.writeArtifact({ job_id: 'wf_safe', name: 'codex_brief', phase: 'codex_brief', revision: 1, producing_role: 'codex', parent_artifact_hash: null, payload: { job_id: 'wf_safe', objective: huge, constraints: [], allowed_file_scope: [], required_checks: [] }, validate: validateCodexBrief, timestamp: now });
    const file = path.join(root, '.orchestry', 'workflows', 'wf_safe', 'artifacts', 'codex-brief.json'); const contents = await fs.readFile(file, 'utf8');
    expect(contents).toContain(huge); expect(stored.metadata.artifact_hash).toMatch(/^[a-f0-9]{64}$/); expect((await fs.stat(file)).mode & 0o777).toBe(0o600); expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  });

  it('rejects stale revisions, hashes, phase skips, and traversal', async () => {
    const first = await store.writeArtifact({ job_id: 'wf_safe', name: 'codex_brief', phase: 'codex_brief', revision: 1, producing_role: 'codex', parent_artifact_hash: null, payload: { job_id: 'wf_safe', objective: 'x', constraints: [], allowed_file_scope: [], required_checks: [] }, validate: validateCodexBrief });
    await expect(store.writeArtifact({ job_id: 'wf_safe', name: 'codex_brief', phase: 'codex_brief', revision: 1, producing_role: 'codex', parent_artifact_hash: first.metadata.artifact_hash, payload: first.payload, validate: validateCodexBrief })).rejects.toThrow('Stale artifact revision');
    await expect(store.transition('wf_safe', 'done')).rejects.toThrow('Invalid workflow phase transition');
    await expect(store.readJob('../escape')).rejects.toThrow('Invalid workflow job id');
  });

  it('redacts secrets and omits environment-shaped fields', async () => {
    await store.appendEvent({ schema_version: 1, job_id: 'wf_safe', type: 'note', timestamp: now, data: { message: 'token=supersecretvalue', env: { HOME: '/tmp' }, password: 'bad' } });
    expect((await store.readEvents('wf_safe'))[0]?.data).toEqual({ message: 'token=[REDACTED]' });
  });
});
