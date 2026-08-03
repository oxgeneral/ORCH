import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProducingRole } from '../../domain/workflow/contracts.js';
import type { ArtifactReference, WorkflowArtifactMetadataV1, WorkflowEventV1, WorkflowJobV1, WorkflowPassportV1, WorkflowSessionsV1 } from '../../domain/workflow/state.js';
import { canTransitionWorkflow, type WorkflowPhase } from '../../domain/workflow/transitions.js';
import { sanitizeForPersistence, sanitizeText } from '../security/redaction.js';
import { appendJsonl, atomicWrite, ensureDir, readJson, readJsonl } from '../storage/fs-utils.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_FIELD = /^(?:env|environment|credentials?|private[_-]?key|privatekey|pem|api[_-]?key|password|passwd|secret|token)$/i;

export const ARTIFACT_FILES = {
  codex_brief: 'codex-brief.json', fable_plan: 'fable-plan-r%REV%.json', codex_plan_review: 'codex-plan-review-r%REV%.json',
  fable_final_prompt: 'fable-final-prompt.md', opus_report: 'opus-report.json', opus_diff: 'opus.diff',
  test_results: 'test-results.json', codex_technical_review: 'codex-technical-review.json',
  fable_compliance_review: 'fable-compliance-review.json', codex_synthesis: 'codex-synthesis.json',
} as const;
export type ArtifactName = keyof typeof ARTIFACT_FILES;

export interface StoredArtifact<T = unknown> { metadata: WorkflowArtifactMetadataV1; payload: T; }
export interface ArtifactWrite<T> { job_id: string; name: ArtifactName; phase: WorkflowPhase; revision: number; producing_role: ProducingRole; parent_artifact_hash: string | null; payload: unknown; validate: (value: unknown) => T; timestamp?: string; }

export class WorkflowArtifactStore {
  private readonly root: string;
  constructor(projectRoot: string) { this.root = path.join(projectRoot, '.orchestry', 'workflows'); }

  async createJob(job: WorkflowJobV1, passport: WorkflowPassportV1, sessions: WorkflowSessionsV1): Promise<void> {
    const id = safeId(job.job_id);
    if (passport.job_id !== id || sessions.job_id !== id) throw new Error('Workflow job_id mismatch');
    await this.secureDir(id);
    if (await this.readJob(id)) throw new Error(`Workflow job already exists: ${id}`);
    await Promise.all([this.write(this.file(id, 'job.json'), job), this.write(this.file(id, 'passport.json'), passport), this.write(this.file(id, 'sessions.json'), sessions)]);
  }

  async writeArtifact<T>(input: ArtifactWrite<T>): Promise<StoredArtifact<T>> {
    const id = safeId(input.job_id);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (input.revision !== job.artifact_revision + 1) throw new Error(`Stale artifact revision: expected ${job.artifact_revision + 1}, received ${input.revision}`);
      if (input.parent_artifact_hash !== job.latest_artifact_hash) throw new Error('Stale parent_artifact_hash');
      if (input.parent_artifact_hash !== null && !SHA256.test(input.parent_artifact_hash)) throw new Error('Invalid parent_artifact_hash');
      if (job.phase !== input.phase) throw new Error(`Artifact phase ${input.phase} does not match job phase ${job.phase}`);
      const payload = input.validate(removeForbidden(input.payload));
      const timestamp = iso(input.timestamp ?? new Date().toISOString());
      const artifactHash = hashCanonical(payload);
      const stored: StoredArtifact<T> = { metadata: { schema_version: 1, job_id: id, phase: input.phase, revision: input.revision, producing_role: input.producing_role, parent_artifact_hash: input.parent_artifact_hash, timestamp, artifact_hash: artifactHash }, payload };
      await this.write(this.artifactFile(id, input.name, job.revision), stored);
      await this.write(this.file(id, 'job.json'), { ...job, artifact_revision: input.revision, latest_artifact_hash: artifactHash, updated_at: timestamp });
      return stored;
    });
  }

  async writeTextArtifact(input: Omit<ArtifactWrite<string>, 'validate'>): Promise<StoredArtifact<string>> {
    return this.writeArtifact({ ...input, validate: (value) => {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`${input.name} must be non-empty text`);
      return sanitizeText(value);
    } });
  }

  async readArtifact<T>(jobId: string, name: ArtifactName, workflowRevision?: number): Promise<StoredArtifact<T> | null> {
    const id = safeId(jobId); const job = await this.requiredJob(id);
    const value = await readJson<StoredArtifact<T>>(this.artifactFile(id, name, workflowRevision ?? job.revision));
    if (!value) return null;
    if (value.metadata.job_id !== id || hashCanonical(value.payload) !== value.metadata.artifact_hash) throw new Error('Workflow artifact integrity check failed');
    return value;
  }

  async readTextArtifact(jobId: string, name: ArtifactName, workflowRevision?: number): Promise<StoredArtifact<string> | null> {
    const id = safeId(jobId); const job = await this.requiredJob(id); const file = this.artifactFile(id, name, workflowRevision ?? job.revision);
    try { const value = JSON.parse(await fs.readFile(file, 'utf8')) as StoredArtifact<string>; if (hashCanonical(value.payload) !== value.metadata.artifact_hash) throw new Error('Workflow artifact integrity check failed'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async transition(jobId: string, next: WorkflowPhase, patch: Partial<WorkflowJobV1> = {}): Promise<WorkflowJobV1> {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (!canTransitionWorkflow(job.phase, next)) throw new Error(`Invalid workflow phase transition: ${job.phase} -> ${next}`);
      const updated: WorkflowJobV1 = { ...job, ...patch, schema_version: 1, job_id: id, phase: next, updated_at: new Date().toISOString() };
      await this.write(this.file(id, 'job.json'), updated); return updated;
    });
  }

  async patchJob(jobId: string, patch: Partial<WorkflowJobV1>): Promise<WorkflowJobV1> {
    const id = safeId(jobId); return this.lock(id, async () => { const job = await this.requiredJob(id); const updated = { ...job, ...patch, schema_version: 1 as const, job_id: id, phase: job.phase, updated_at: new Date().toISOString() }; await this.write(this.file(id, 'job.json'), updated); return updated; });
  }
  async readJob(jobId: string): Promise<WorkflowJobV1 | null> { const id = safeId(jobId); return readJson<WorkflowJobV1>(this.file(id, 'job.json')); }
  async readPassport(jobId: string): Promise<WorkflowPassportV1 | null> { const id = safeId(jobId); return readJson<WorkflowPassportV1>(this.file(id, 'passport.json')); }
  async writePassport(value: WorkflowPassportV1): Promise<void> { safeId(value.job_id); await this.requiredJob(value.job_id); await this.write(this.file(value.job_id, 'passport.json'), value); }
  async readSessions(jobId: string): Promise<WorkflowSessionsV1 | null> { const id = safeId(jobId); return readJson<WorkflowSessionsV1>(this.file(id, 'sessions.json')); }
  async writeSessions(value: WorkflowSessionsV1): Promise<void> { safeId(value.job_id); await this.requiredJob(value.job_id); await this.write(this.file(value.job_id, 'sessions.json'), value); }
  async appendEvent(event: WorkflowEventV1): Promise<void> { const id = safeId(event.job_id); await this.requiredJob(id); await appendJsonl(this.file(id, 'events.jsonl'), { ...event, data: removeForbidden(event.data) }); await fs.chmod(this.file(id, 'events.jsonl'), 0o600).catch(() => {}); }
  async readEvents(jobId: string): Promise<WorkflowEventV1[]> { return readJsonl<WorkflowEventV1>(this.file(safeId(jobId), 'events.jsonl')); }
  artifactPath(jobId: string, name: ArtifactName, revision: number): string { return this.artifactFile(safeId(jobId), name, revision); }

  private async requiredJob(id: string): Promise<WorkflowJobV1> { const job = await this.readJob(id); if (!job) throw new Error(`Workflow job not found: ${id}`); return job; }
  private file(id: string, name: string): string { return path.join(this.root, safeId(id), name); }
  private artifactFile(id: string, name: ArtifactName, revision: number): string { const filename = ARTIFACT_FILES[name].replace('%REV%', String(revision).padStart(3, '0')); return path.join(this.root, safeId(id), 'artifacts', filename); }
  private async write(file: string, value: unknown): Promise<void> { await atomicWrite(file, canonicalJson(removeForbidden(value)) + '\n'); }
  private async secureDir(id: string): Promise<void> { const dir = this.file(id, ''); await ensureDir(path.join(dir, 'artifacts')); await Promise.all([fs.chmod(this.root, 0o700).catch(() => {}), fs.chmod(dir, 0o700), fs.chmod(path.join(dir, 'artifacts'), 0o700)]); }
  private async lock<T>(id: string, fn: () => Promise<T>): Promise<T> { await this.secureDir(id); const lock = this.file(id, '.workflow.lock'); const deadline = Date.now() + 5_000; while (true) { try { await fs.mkdir(lock, { mode: 0o700 }); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 10)); } } try { return await fn(); } finally { await fs.rm(lock, { recursive: true, force: true }); } }
}

export function artifactReference<T>(name: string, stored: StoredArtifact<T>): ArtifactReference { return { filename: name, hash: stored.metadata.artifact_hash, phase: stored.metadata.phase, revision: stored.metadata.revision }; }
export function hashCanonical(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const o = value as Record<string, unknown>; return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`; }
function removeForbidden(value: unknown): unknown { const safe = sanitizeForPersistence(value); if (Array.isArray(safe)) return safe.map(removeForbidden); if (safe && typeof safe === 'object') { const out: Record<string, unknown> = {}; for (const [key, nested] of Object.entries(safe)) if (!FORBIDDEN_FIELD.test(key)) out[key] = removeForbidden(nested); return out; } return safe; }
function safeId(value: string): string { if (!SAFE_ID.test(value) || value === '.' || value === '..') throw new Error(`Invalid workflow job id: ${value}`); return value; }
function iso(value: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp'); return value; }
