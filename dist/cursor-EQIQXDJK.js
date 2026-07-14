import { buildChildEnv, buildFullPrompt, createStreamingEvents, extractTokens } from './chunk-AAD6WJ7E.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-BBYWS5VU.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
async function findCommand() {
  for (const cmd of ["cursor-agent", "agent"]) {
    try {
      const { stdout } = await execFileAsync(cmd, ["--version"]);
      return { command: cmd, version: stdout.trim() };
    } catch {
    }
  }
  return null;
}
var CursorAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  kind = "cursor";
  resolvedCommand = "cursor-agent";
  async test() {
    const found = await findCommand();
    if (found) {
      this.resolvedCommand = found.command;
      return { ok: true, version: found.version };
    }
    return {
      ok: false,
      error: "Cursor Agent CLI not found. The headless agent CLI is required (cursor-agent or agent).",
      errorKind: "adapter_not_found" /* ADAPTER_NOT_FOUND */
    };
  }
  execute(params) {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--workspace",
      params.workspace
    ];
    if (params.security?.allowPermissionBypass === true) {
      args.push("--yolo");
    }
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    const { process: proc, pid } = this.processManager.spawn(this.resolvedCommand, args, {
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal,
      stdio: ["pipe", "pipe", "pipe"]
      // stdin must be 'pipe' to send prompt
    });
    if (proc.stdin) {
      proc.stdin.write(buildFullPrompt(params.systemPrompt, params.prompt));
      proc.stdin.end();
    }
    const events = createStreamingEvents(proc, parseCursorEvent, "Cursor agent", params.signal);
    return { pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function parseCursorEvent(line) {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    switch (parsed.type) {
      case "assistant":
        return { type: "output", timestamp, data: parsed.message ?? parsed };
      case "tool_use":
        return { type: "tool_call", timestamp, data: parsed };
      case "tool_result":
        return { type: "output", timestamp, data: parsed };
      case "error": {
        const errData = parsed.error ?? parsed;
        const errMsg = typeof errData === "string" ? errData : JSON.stringify(errData);
        return { type: "error", timestamp, data: errData, errorKind: classifyAdapterError(errMsg) };
      }
      case "result": {
        const tokens = extractTokens(parsed);
        return { type: "done", timestamp, data: parsed, tokens };
      }
      default:
        return { type: "output", timestamp, data: parsed };
    }
  } catch {
    return { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: line };
  }
}

export { CursorAdapter };
//# sourceMappingURL=cursor-EQIQXDJK.js.map
//# sourceMappingURL=cursor-EQIQXDJK.js.map