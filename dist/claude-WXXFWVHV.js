import { buildChildEnv, buildFullPrompt, createStreamingEvents, extractTokens } from './chunk-RFV7B6JD.js';
import './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var ClaudeAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  processManager;
  kind = "claude";
  async test() {
    try {
      const { stdout } = await execFileAsync("claude", ["--version"]);
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--max-turns",
      String(params.config.max_turns ?? 50),
      "--verbose"
    ];
    if (params.security?.allowPermissionBypass === true) {
      args.push("--dangerously-skip-permissions");
    }
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    if (params.config.effort) {
      args.push("--effort", params.config.effort);
    }
    const effectiveSystemPrompt = params.systemPrompt ?? params.config.system_prompt;
    const { process: proc, pid } = this.processManager.spawn("claude", args, {
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      stdio: ["pipe", "pipe", "pipe"],
      signal: params.signal
    });
    proc.stdin?.write(buildFullPrompt(effectiveSystemPrompt, params.prompt));
    proc.stdin?.end();
    const events = createStreamingEvents(proc, parseClaudeEvent, "Claude", params.signal);
    return { pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function parseClaudeEvent(line) {
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
        const tokens = extractTokens(parsed, { statsFallback: true });
        return { type: "done", timestamp, data: parsed, tokens };
      }
      default:
        return { type: "output", timestamp, data: parsed };
    }
  } catch {
    return { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: line };
  }
}

export { ClaudeAdapter };
//# sourceMappingURL=claude-WXXFWVHV.js.map
//# sourceMappingURL=claude-WXXFWVHV.js.map