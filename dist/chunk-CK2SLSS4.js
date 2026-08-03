import { readJson, appendJsonl, readJsonl, atomicWrite, ensureDir } from './chunk-54K3JU53.js';
import { sanitizeText, sanitizeForPersistence } from './chunk-RQZGDMFG.js';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// src/domain/workflow/transitions.ts
var ACTIVE = ["codex_brief", "fable_plan", "codex_plan_review", "fable_final_prompt", "opus_execution", "codex_technical_review", "fable_compliance_review", "codex_synthesis", "merge_ready"];
var WORKFLOW_PHASE_TRANSITIONS = {
  codex_brief: ["fable_plan", "blocked", "paused", "cancelled", "failed"],
  fable_plan: ["codex_plan_review", "blocked", "paused", "cancelled", "failed"],
  codex_plan_review: ["fable_plan", "fable_final_prompt", "blocked", "paused", "cancelled", "failed"],
  fable_final_prompt: ["opus_execution", "blocked", "paused", "cancelled", "failed"],
  opus_execution: ["codex_technical_review", "blocked", "paused", "cancelled", "failed"],
  codex_technical_review: ["fable_compliance_review", "codex_synthesis", "paused", "cancelled", "failed"],
  fable_compliance_review: ["codex_synthesis", "paused", "cancelled", "failed"],
  codex_synthesis: ["opus_execution", "fable_plan", "merge_ready", "blocked", "paused", "cancelled", "failed"],
  merge_ready: ["done", "failed", "paused", "cancelled"],
  done: [],
  blocked: ["codex_brief", "fable_plan", "codex_plan_review", "fable_final_prompt", "opus_execution", "codex_technical_review", "fable_compliance_review", "codex_synthesis", "merge_ready", "cancelled"],
  paused: [...ACTIVE, "blocked", "cancelled"],
  cancelled: [],
  failed: []
};
function canTransitionWorkflow(from, to) {
  return WORKFLOW_PHASE_TRANSITIONS[from].includes(to);
}
function transitionWorkflow(from, to) {
  if (!canTransitionWorkflow(from, to)) throw new Error(`Invalid workflow phase transition: ${from} -> ${to}`);
  return to;
}
function isTerminalWorkflowPhase(phase) {
  return phase === "done" || phase === "cancelled" || phase === "failed";
}

// src/infrastructure/workflow/artifact-store.ts
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var SHA256 = /^[a-f0-9]{64}$/;
var FORBIDDEN_FIELD = /^(?:env|environment|credentials?|private[_-]?key|privatekey|pem|api[_-]?key|password|passwd|secret|token)$/i;
var ARTIFACT_FILES = {
  codex_brief: "codex-brief.json",
  fable_plan: "fable-plan-r%REV%.json",
  codex_plan_review: "codex-plan-review-r%REV%.json",
  fable_final_prompt: "fable-final-prompt.md",
  opus_report: "opus-report.json",
  opus_diff: "opus.diff",
  test_results: "test-results.json",
  codex_technical_review: "codex-technical-review.json",
  fable_compliance_review: "fable-compliance-review.json",
  codex_synthesis: "codex-synthesis.json"
};
var WorkflowArtifactStore = class {
  root;
  constructor(projectRoot) {
    this.root = path.join(projectRoot, ".orchestry", "workflows");
  }
  async createJob(job, passport, sessions) {
    const id = safeId(job.job_id);
    if (passport.job_id !== id || sessions.job_id !== id) throw new Error("Workflow job_id mismatch");
    await this.secureDir(id);
    if (await this.readJob(id)) throw new Error(`Workflow job already exists: ${id}`);
    await Promise.all([this.write(this.file(id, "job.json"), job), this.write(this.file(id, "passport.json"), passport), this.write(this.file(id, "sessions.json"), sessions)]);
  }
  async writeArtifact(input) {
    const id = safeId(input.job_id);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (input.revision !== job.artifact_revision + 1) throw new Error(`Stale artifact revision: expected ${job.artifact_revision + 1}, received ${input.revision}`);
      if (input.parent_artifact_hash !== job.latest_artifact_hash) throw new Error("Stale parent_artifact_hash");
      if (input.parent_artifact_hash !== null && !SHA256.test(input.parent_artifact_hash)) throw new Error("Invalid parent_artifact_hash");
      if (job.phase !== input.phase) throw new Error(`Artifact phase ${input.phase} does not match job phase ${job.phase}`);
      const payload = input.validate(removeForbidden(input.payload));
      const timestamp = iso(input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString());
      const artifactHash = hashCanonical(payload);
      const stored = { metadata: { schema_version: 1, job_id: id, phase: input.phase, revision: input.revision, producing_role: input.producing_role, parent_artifact_hash: input.parent_artifact_hash, timestamp, artifact_hash: artifactHash }, payload };
      await this.write(this.artifactFile(id, input.name, job.revision), stored);
      await this.write(this.file(id, "job.json"), { ...job, artifact_revision: input.revision, latest_artifact_hash: artifactHash, updated_at: timestamp });
      return stored;
    });
  }
  async writeTextArtifact(input) {
    return this.writeArtifact({ ...input, validate: (value) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${input.name} must be non-empty text`);
      return sanitizeText(value);
    } });
  }
  async readArtifact(jobId, name, workflowRevision) {
    const id = safeId(jobId);
    const job = await this.requiredJob(id);
    const value = await readJson(this.artifactFile(id, name, workflowRevision ?? job.revision));
    if (!value) return null;
    if (value.metadata.job_id !== id || hashCanonical(value.payload) !== value.metadata.artifact_hash) throw new Error("Workflow artifact integrity check failed");
    return value;
  }
  async readTextArtifact(jobId, name, workflowRevision) {
    const id = safeId(jobId);
    const job = await this.requiredJob(id);
    const file = this.artifactFile(id, name, workflowRevision ?? job.revision);
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"));
      if (hashCanonical(value.payload) !== value.metadata.artifact_hash) throw new Error("Workflow artifact integrity check failed");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async transition(jobId, next, patch = {}) {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      if (!canTransitionWorkflow(job.phase, next)) throw new Error(`Invalid workflow phase transition: ${job.phase} -> ${next}`);
      const updated = { ...job, ...patch, schema_version: 1, job_id: id, phase: next, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      await this.write(this.file(id, "job.json"), updated);
      return updated;
    });
  }
  async patchJob(jobId, patch) {
    const id = safeId(jobId);
    return this.lock(id, async () => {
      const job = await this.requiredJob(id);
      const updated = { ...job, ...patch, schema_version: 1, job_id: id, phase: job.phase, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      await this.write(this.file(id, "job.json"), updated);
      return updated;
    });
  }
  async readJob(jobId) {
    const id = safeId(jobId);
    return readJson(this.file(id, "job.json"));
  }
  async readPassport(jobId) {
    const id = safeId(jobId);
    return readJson(this.file(id, "passport.json"));
  }
  async writePassport(value) {
    safeId(value.job_id);
    await this.requiredJob(value.job_id);
    await this.write(this.file(value.job_id, "passport.json"), value);
  }
  async readSessions(jobId) {
    const id = safeId(jobId);
    return readJson(this.file(id, "sessions.json"));
  }
  async writeSessions(value) {
    safeId(value.job_id);
    await this.requiredJob(value.job_id);
    await this.write(this.file(value.job_id, "sessions.json"), value);
  }
  async appendEvent(event) {
    const id = safeId(event.job_id);
    await this.requiredJob(id);
    await appendJsonl(this.file(id, "events.jsonl"), { ...event, data: removeForbidden(event.data) });
    await fs.chmod(this.file(id, "events.jsonl"), 384).catch(() => {
    });
  }
  async readEvents(jobId) {
    return readJsonl(this.file(safeId(jobId), "events.jsonl"));
  }
  artifactPath(jobId, name, revision) {
    return this.artifactFile(safeId(jobId), name, revision);
  }
  async requiredJob(id) {
    const job = await this.readJob(id);
    if (!job) throw new Error(`Workflow job not found: ${id}`);
    return job;
  }
  file(id, name) {
    return path.join(this.root, safeId(id), name);
  }
  artifactFile(id, name, revision) {
    const filename = ARTIFACT_FILES[name].replace("%REV%", String(revision).padStart(3, "0"));
    return path.join(this.root, safeId(id), "artifacts", filename);
  }
  async write(file, value) {
    await atomicWrite(file, canonicalJson(removeForbidden(value)) + "\n");
  }
  async secureDir(id) {
    const dir = this.file(id, "");
    await ensureDir(path.join(dir, "artifacts"));
    await Promise.all([fs.chmod(this.root, 448).catch(() => {
    }), fs.chmod(dir, 448), fs.chmod(path.join(dir, "artifacts"), 448)]);
  }
  async lock(id, fn) {
    await this.secureDir(id);
    const lock = this.file(id, ".workflow.lock");
    const deadline = Date.now() + 5e3;
    while (true) {
      try {
        await fs.mkdir(lock, { mode: 448 });
        break;
      } catch (e) {
        if (e.code !== "EEXIST" || Date.now() > deadline) throw e;
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  }
};
function artifactReference(name, stored) {
  return { filename: name, hash: stored.metadata.artifact_hash, phase: stored.metadata.phase, revision: stored.metadata.revision };
}
function hashCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
function removeForbidden(value) {
  const safe = sanitizeForPersistence(value);
  if (Array.isArray(safe)) return safe.map(removeForbidden);
  if (safe && typeof safe === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(safe)) if (!FORBIDDEN_FIELD.test(key)) out[key] = removeForbidden(nested);
    return out;
  }
  return safe;
}
function safeId(value) {
  if (!SAFE_ID.test(value) || value === "." || value === "..") throw new Error(`Invalid workflow job id: ${value}`);
  return value;
}
function iso(value) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  return value;
}

export { ARTIFACT_FILES, WORKFLOW_PHASE_TRANSITIONS, WorkflowArtifactStore, artifactReference, canTransitionWorkflow, hashCanonical, isTerminalWorkflowPhase, transitionWorkflow };
//# sourceMappingURL=chunk-CK2SLSS4.js.map
//# sourceMappingURL=chunk-CK2SLSS4.js.map