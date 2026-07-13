import { buildFullPrompt, buildChildEnv, createStreamingEvents } from './chunk-T43AHB5M.js';
import { createTokenUsage } from './chunk-GZVITBV7.js';
import { classifyAdapterError } from './chunk-IESAV453.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var OpenCodeAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  kind = "opencode";
  async test() {
    try {
      const { stdout } = await execFileAsync("opencode", ["--version"]);
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "OpenCode CLI not found. Install: npm i -g opencode",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    const args = [
      "run",
      "--format",
      "json"
    ];
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    const fullPrompt = buildFullPrompt(params.systemPrompt, params.prompt);
    args.push(fullPrompt);
    const { process: proc, pid } = this.processManager.spawn("opencode", args, {
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal
    });
    const events = createStreamingEvents(proc, parseOpenCodeEvent, "OpenCode", params.signal);
    return { pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function parseOpenCodeEvent(line) {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const type = parsed.type ?? "";
    const part = parsed.part ?? {};
    switch (type) {
      case "step_start":
        return null;
      // lifecycle event — no user-visible content
      case "text":
        return { type: "output", timestamp, data: part.text ?? part };
      case "tool_use": {
        const state = part.state ?? {};
        if (state.status === "error") {
          const errMsg = typeof state.error === "string" ? state.error : JSON.stringify(state);
          return { type: "error", timestamp, data: state, errorKind: classifyAdapterError(errMsg) };
        }
        return { type: "tool_call", timestamp, data: { name: part.tool, input: state.input } };
      }
      case "step_finish": {
        const reason = part.reason;
        const tokens = extractOpenCodeTokens(part);
        if (reason === "error") {
          const errMsg = typeof part.error === "string" ? part.error : JSON.stringify(part);
          return { type: "error", timestamp, data: part, tokens, errorKind: classifyAdapterError(errMsg) };
        }
        if (reason === "tool-calls") {
          return null;
        }
        return { type: "done", timestamp, data: part, tokens };
      }
      default:
        return { type: "output", timestamp, data: parsed };
    }
  } catch {
    return { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: line };
  }
}
function extractOpenCodeTokens(part) {
  const tokens = part.tokens;
  if (!tokens || typeof tokens.input !== "number") return void 0;
  const input = tokens.input;
  const output = typeof tokens.output === "number" ? tokens.output : 0;
  const reasoning = typeof tokens.reasoning === "number" ? tokens.reasoning : 0;
  return createTokenUsage(input, output, { reasoning });
}

export { OpenCodeAdapter };
//# sourceMappingURL=opencode-XF75C2F4.js.map
//# sourceMappingURL=opencode-XF75C2F4.js.map