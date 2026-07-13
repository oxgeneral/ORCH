import { buildChildEnv, buildFullPrompt, createStreamingEvents, extractTokens } from './chunk-DZTQRHUE.js';
import './chunk-GZVITBV7.js';
import { classifyAdapterError } from './chunk-IESAV453.js';
import './chunk-O2MSGW3V.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var CodexAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  kind = "codex";
  async test() {
    try {
      const { stdout } = await execFileAsync("codex", ["--version"]);
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Codex CLI not found. Install: npm i -g @openai/codex",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    const args = [
      "exec",
      "--json"
    ];
    if (params.security?.allowPermissionBypass) {
      args.push("--sandbox", "danger-full-access");
    }
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    args.push("-");
    const { process: proc, pid } = this.processManager.spawn("codex", args, {
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
    const events = createStreamingEvents(proc, parseCodexEvent, "Codex", params.signal);
    return { pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function parseCodexEvent(line) {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const type = parsed.type ?? "";
    switch (type) {
      // Thread/session started
      case "thread.started":
        return { type: "output", timestamp, data: parsed };
      // Turn lifecycle
      case "turn.started":
        return { type: "output", timestamp, data: parsed };
      case "turn.completed": {
        const tokens = extractTokens(parsed);
        return { type: "done", timestamp, data: parsed, tokens };
      }
      case "turn.failed": {
        const tokens = extractTokens(parsed);
        const failMsg = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed);
        return { type: "error", timestamp, data: parsed, tokens, errorKind: classifyAdapterError(failMsg) };
      }
      // Item events
      case "item.started":
      case "item.completed": {
        const item = parsed.item ?? {};
        const itemType = item.type ?? "";
        if (itemType === "agent_message") {
          return { type: "output", timestamp, data: item };
        }
        if (itemType === "reasoning") {
          return { type: "output", timestamp, data: item };
        }
        if (itemType === "command_execution") {
          return { type: "command", timestamp, data: item };
        }
        if (itemType === "file_change") {
          const changes = Array.isArray(item.changes) ? item.changes : [];
          const paths = changes.map((c) => typeof c.path === "string" ? c.path : "").filter(Boolean);
          return { type: "file_change", timestamp, data: { paths, raw: item } };
        }
        if (itemType === "tool_use") {
          return { type: "tool_call", timestamp, data: item };
        }
        if (itemType === "tool_result") {
          return { type: "output", timestamp, data: item };
        }
        if (itemType === "error") {
          const itemErrMsg = typeof item.message === "string" ? item.message : JSON.stringify(item);
          return { type: "error", timestamp, data: item, errorKind: classifyAdapterError(itemErrMsg) };
        }
        return { type: "output", timestamp, data: item };
      }
      case "error": {
        const errData = parsed.error ?? parsed;
        const errMsg = typeof errData === "string" ? errData : JSON.stringify(errData);
        return { type: "error", timestamp, data: errData, errorKind: classifyAdapterError(errMsg) };
      }
      default:
        return { type: "output", timestamp, data: parsed };
    }
  } catch {
    return { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: line };
  }
}

export { CodexAdapter };
//# sourceMappingURL=codex-VDXRG4NE.js.map
//# sourceMappingURL=codex-VDXRG4NE.js.map