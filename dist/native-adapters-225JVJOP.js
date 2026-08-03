import { buildChildEnv } from './chunk-RFV7B6JD.js';
import './chunk-UG72A2JI.js';
import './chunk-Z7JNYNWE.js';
import { hashCanonical } from './chunk-CK2SLSS4.js';
import './chunk-54K3JU53.js';
import './chunk-RQZGDMFG.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var NativeCodexWorkflowAdapter = class {
  constructor(pm) {
    this.pm = pm;
  }
  pm;
  brief(passport, thread) {
    return this.call("Create a concise implementation brief as strict JSON with job_id, objective, constraints, allowed_file_scope, required_checks.", passport, thread);
  }
  reviewPlan(passport, plan, thread) {
    return this.call("Review this plan. Return only strict JSON with job_id, revision, verdict GO|GO_WITH_PATCH|REPLAN|BLOCKED, material_change, mandatory_changes, acceptance_criteria, concise_reason, next_phase. GO_WITH_PATCH must be non-material.", { passport, plan }, thread);
  }
  compileFinalPrompt(passport, plan, thread) {
    return this.callText("Compile a concise executable Opus prompt from the approved passport and plan. Output prompt text only.", { passport, plan }, thread);
  }
  technicalReview(passport, evidence, checks, thread) {
    return this.call("Inspect the files in the current worktree plus the actual diff and checks as primary evidence. Return only strict JSON with job_id, reviewed_commit, checks_passed, evidence, required_fixes, concise_reason.", { passport, evidence, checks }, thread, evidence.worktree);
  }
  synthesize(passport, technical, compliance, checks, thread) {
    return this.call("Synthesize reviews. Return only strict JSON with job_id, reviewed_commit, verdict DONE|FIX|REPLAN|BLOCKED, merge_allowed, evidence, required_fixes, concise_reason. DONE requires passing checks.", { passport, technical, compliance, checks }, thread);
  }
  async available() {
    return availability("codex");
  }
  async call(instruction, projection, thread, cwd = process.cwd()) {
    const result = await this.run(instruction, projection, cwd);
    return { value: parseJson(result.text), session_id: result.sessionId ?? thread ?? void 0, resumed: false, resume_failed: thread !== null, usage: result.usage };
  }
  async callText(instruction, projection, thread) {
    const result = await this.run(instruction, projection, process.cwd());
    return { value: result.text, session_id: result.sessionId ?? thread ?? void 0, resumed: false, resume_failed: thread !== null, usage: result.usage };
  }
  async run(instruction, projection, cwd) {
    const prompt = bounded(`${instruction}

${JSON.stringify(projection)}`, 256e3);
    const output = await spawnCapture(this.pm, "codex", ["exec", "--json", "--sandbox", "read-only", "-"], cwd, prompt, 1e6);
    const lines = output.split("\n").filter(Boolean).map(parseObject);
    let text = "";
    let sessionId;
    let usage = {};
    for (const line of lines) {
      if (line.type === "thread.started" && typeof line.thread_id === "string") sessionId = line.thread_id;
      const item = object(line.item);
      if (item.type === "agent_message" && typeof item.text === "string") text = item.text;
      if (line.type === "turn.completed") usage = usageObject(line.usage);
    }
    if (!text) throw new Error("Codex returned no agent message");
    return { text, sessionId, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } };
  }
};
var NativeFableWorkflowAdapter = class {
  constructor(pm) {
    this.pm = pm;
  }
  pm;
  plan(passport, brief, previous, changes, options) {
    return this.call("Produce only strict JSON: job_id, revision, assumptions, acceptance_criteria, implementation_steps, risks, questions_requiring_human.", { passport, brief, previous, changes }, options, true);
  }
  finalPrompt(passport, plan, amendments, options) {
    return this.call("Apply bounded amendments and output only the final implementation prompt.", { passport, plan, amendments }, options, false);
  }
  compliance(passport, plan, opus, evidence, checks, options) {
    return this.call("Evaluate plan compliance from this compact evidence. Output only strict JSON: job_id, approved_plan_hash, verdict ALIGNED|GAPS_FOUND|UNCERTAIN, plan_deviations, missing_requirements, recommended_repairs.", { passport, plan, opus, evidence: compactEvidence(evidence), checks }, options, true);
  }
  async available() {
    return availability("claude");
  }
  async call(instruction, projection, options, json) {
    const prompt = bounded(`${instruction}

${JSON.stringify(projection)}`, options.max_input_bytes);
    const result = await claudeCall(this.pm, prompt, options.workspace, "fable", 1, options.max_output_bytes, true);
    return { value: json ? parseJson(result.text) : result.text, session_id: result.sessionId, usage: result.usage };
  }
};
var NativeOpusWorkflowAdapter = class {
  constructor(pm) {
    this.pm = pm;
  }
  pm;
  async execute(passport, prompt, workspace, sessionId, mode) {
    const taskContext = JSON.stringify({
      job_id: passport.job_id,
      objective: passport.objective,
      approved_plan_hash: passport.approved_plan_hash,
      acceptance_criteria: passport.acceptance_criteria,
      mandatory_amendments: passport.mandatory_amendments,
      allowed_file_scope: passport.allowed_file_scope,
      required_checks: passport.required_checks
    });
    const recovery = mode === "resume" ? `A native resume flag is not verified. Continue from this persisted passport and current worktree state.
${JSON.stringify(passport)}

` : "";
    const instruction = `Task passport projection:
${taskContext}

Do not modify files outside allowed_file_scope when it is non-empty.

${recovery}${prompt}

Implement, test, and commit on the current worktree branch. End with strict JSON: job_id, status completed|partial|failed, files_changed, commands_run, tests_reported, deviations, unresolved, summary.`;
    const result = await claudeCall(this.pm, bounded(instruction, passport.config.max_input_bytes), workspace, "opus", 50, passport.config.max_output_bytes);
    return { value: parseJson(result.text), session_id: result.sessionId ?? sessionId ?? void 0, resumed: false, resume_failed: mode === "resume", usage: result.usage };
  }
  async available() {
    return availability("claude");
  }
};
var NativeWorkflowGitGateway = class {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  projectRoot;
  async prepare(jobId) {
    const branch = `orchestry/workflow/${jobId}`;
    const worktree = path.join(this.projectRoot, ".orchestry", "workspaces", jobId);
    await fs.mkdir(path.dirname(worktree), { recursive: true, mode: 448 });
    try {
      await git(this.projectRoot, ["worktree", "add", worktree, "-b", branch]);
    } catch {
      await git(this.projectRoot, ["worktree", "prune"]);
      await git(this.projectRoot, ["worktree", "add", worktree, branch]);
    }
    await fs.rm(path.join(worktree, ".orchestry"), { recursive: true, force: true });
    return { branch, worktree };
  }
  async inspect(branch, worktree) {
    const status = (await git(worktree, ["status", "--porcelain"])).trim();
    if (status) throw new Error("Opus worktree contains uncommitted changes; review requires a committed snapshot");
    const commit = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    const base = (await git(this.projectRoot, ["merge-base", "HEAD", branch])).trim();
    const diff = await git(this.projectRoot, ["diff", "--binary", `${base}...${commit}`], 16 * 1024 * 1024);
    const files = (await git(this.projectRoot, ["diff", "--name-only", `${base}...${commit}`])).trim().split("\n").filter(Boolean);
    const stat = await git(this.projectRoot, ["diff", "--numstat", `${base}...${commit}`]);
    let insertions = 0;
    let deletions = 0;
    for (const line of stat.split("\n")) {
      const [a, d] = line.split("	");
      insertions += Number(a) || 0;
      deletions += Number(d) || 0;
    }
    const risk_signals = files.filter((file) => /auth|security|secret|migration|deploy|infra|billing/i.test(file));
    return { branch, worktree, commit, diff, diff_hash: hashCanonical(diff), files_changed: files, insertions, deletions, risk_signals };
  }
  async runChecks(worktree, commit, commands) {
    const checks = [];
    for (const command of commands) {
      try {
        const { stdout, stderr } = await execFileAsync("/bin/sh", ["-lc", command], { cwd: worktree, env: buildChildEnv(), maxBuffer: 4 * 1024 * 1024 });
        checks.push({ command, passed: true, output: `${stdout}${stderr}` });
      } catch (error) {
        const e = error;
        checks.push({ command, passed: false, output: `${e.stdout ?? ""}${e.stderr ?? e.message}` });
      }
    }
    return { job_id: path.basename(worktree), commit, passed: checks.every((check) => check.passed), checks };
  }
  async currentCommit(branch) {
    return (await git(this.projectRoot, ["rev-parse", branch])).trim();
  }
  async merge(branch) {
    try {
      if (!branch.startsWith("orchestry/workflow/")) return { success: false, detail: "Refusing to merge a non-workflow branch" };
      const status = (await git(this.projectRoot, ["status", "--porcelain"])).trim();
      if (status) return { success: false, detail: "Controller worktree is dirty" };
      await git(this.projectRoot, ["merge", "--no-ff", branch, "-m", `Merge ${branch}`]);
      return { success: true, detail: "merged" };
    } catch (error) {
      await git(this.projectRoot, ["merge", "--abort"]).catch(() => "");
      return { success: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
};
async function claudeCall(pm, prompt, cwd, model, maxTurns, maxOutput, toolFree = false) {
  const args = ["--print", "--output-format", "stream-json", "--max-turns", String(maxTurns), "--verbose", "--model", model, "--effort", "low"];
  if (toolFree) args.push("--bare", "--tools", "", "--disable-slash-commands", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence");
  const output = await spawnCapture(pm, "claude", args, cwd, prompt, maxOutput);
  let text = "";
  let sessionId;
  let usage = {};
  for (const line of output.split("\n").filter(Boolean).map(parseObject)) {
    if (line.type === "result") {
      if (typeof line.result === "string") text = line.result;
      if (typeof line.session_id === "string") sessionId = line.session_id;
      usage = usageObject(line.usage);
    }
  }
  if (!text) throw new Error("Claude returned no result");
  return { text, sessionId, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read: usage.cache_read_input_tokens, cache_write: usage.cache_creation_input_tokens } };
}
async function spawnCapture(pm, command, args, cwd, input, maxBytes) {
  const { process: child } = pm.spawn(command, args, { cwd, env: buildChildEnv(), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let exceeded = false;
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
    if (Buffer.byteLength(stdout) > maxBytes) {
      exceeded = true;
      child.kill();
    }
  });
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 64e3) stderr += chunk.toString();
  });
  child.stdin?.end(input);
  const code = await new Promise((resolve, reject) => {
    child.on("close", (value) => resolve(value ?? 1));
    child.on("error", reject);
  });
  if (exceeded) throw new Error(`${command} output exceeded configured maximum`);
  if (code !== 0) throw new Error(`${command} exited ${code}: ${stderr}`);
  return stdout;
}
async function availability(command) {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], { env: buildChildEnv() });
    return { available: true, detail: stdout.trim() };
  } catch {
    return { available: false, detail: `${command} CLI unavailable` };
  }
}
async function git(cwd, args, maxBuffer = 4 * 1024 * 1024) {
  const { stdout } = await execFileAsync("git", args, { cwd, env: buildChildEnv(), maxBuffer });
  return stdout;
}
function parseObject(line) {
  try {
    return JSON.parse(line);
  } catch {
    return {};
  }
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function usageObject(value) {
  const result = {};
  for (const [key, nested] of Object.entries(object(value))) if (typeof nested === "number") result[key] = nested;
  return result;
}
function parseJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("Role returned malformed JSON");
  }
}
function bounded(value, max) {
  if (Buffer.byteLength(value) > max) throw new Error("Role input exceeded configured maximum");
  return value;
}
function compactEvidence(value) {
  return { commit: value.commit, diff_hash: value.diff_hash, files_changed: value.files_changed, insertions: value.insertions, deletions: value.deletions, risk_signals: value.risk_signals };
}

export { NativeCodexWorkflowAdapter, NativeFableWorkflowAdapter, NativeOpusWorkflowAdapter, NativeWorkflowGitGateway };
//# sourceMappingURL=native-adapters-225JVJOP.js.map
//# sourceMappingURL=native-adapters-225JVJOP.js.map