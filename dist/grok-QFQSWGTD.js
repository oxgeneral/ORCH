import { buildChildEnv } from './chunk-DZTQRHUE.js';
import './chunk-GZVITBV7.js';
import { classifyAdapterError } from './chunk-IESAV453.js';
import { readLines } from './chunk-O2MSGW3V.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var OUTPUT_CHUNK_LEN = 240;
var GrokAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  kind = "grok";
  async test() {
    try {
      const { stdout } = await execFileAsync("grok", ["--version"]);
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Grok CLI not found. Install and authenticate the grok CLI, then ensure `grok` is on PATH.",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    const args = [
      "-p",
      params.prompt,
      "--output-format",
      "streaming-json",
      "--cwd",
      params.workspace
    ];
    if (params.security?.allowPermissionBypass) {
      args.push("--permission-mode", "bypassPermissions", "--always-approve");
    }
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    if (params.config.effort) {
      args.push("--effort", params.config.effort);
    }
    if (params.config.max_turns) {
      args.push("--max-turns", String(params.config.max_turns));
    }
    const effectiveSystemPrompt = params.systemPrompt ?? params.config.system_prompt;
    if (effectiveSystemPrompt) {
      args.push("--system-prompt-override", effectiveSystemPrompt);
    }
    const { process: proc, pid } = this.processManager.spawn("grok", args, {
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal
    });
    const events = createGrokEvents(proc, params.signal);
    return { pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function createGrokEvents(proc, signal) {
  async function* generate() {
    let gotDoneEvent = false;
    let textBuffer = "";
    let finalText = "";
    let exitCode = null;
    let exitError = null;
    const exitPromise = new Promise((resolve) => {
      proc.on("close", (code) => {
        exitCode = code;
        resolve();
      });
      proc.on("error", (err) => {
        exitError = err;
        resolve();
      });
    });
    const flushOutput = function* () {
      if (!textBuffer) return;
      const chunk = textBuffer;
      textBuffer = "";
      yield {
        type: "output",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { text: chunk }
      };
    };
    if (proc.stdout) {
      try {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          const event = parseGrokEvent(line, {
            appendText: (text) => {
              textBuffer += text;
              finalText += text;
            },
            finalText: () => finalText
          });
          if (!event) {
            if (textBuffer.length >= OUTPUT_CHUNK_LEN) {
              yield* flushOutput();
            }
            continue;
          }
          if (event.type === "done") {
            yield* flushOutput();
            gotDoneEvent = true;
          }
          yield event;
        }
      } finally {
        proc.stdout.destroy();
      }
    }
    await exitPromise;
    if (!gotDoneEvent && !signal?.aborted) {
      yield* flushOutput();
    }
    if (exitError && !signal?.aborted && !gotDoneEvent) {
      const spawnErr = exitError;
      throw Object.assign(new Error(spawnErr.message), {
        errorKind: classifyAdapterError(spawnErr.message, exitCode ?? void 0)
      });
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const msg = `Grok process exited with code ${exitCode}`;
      throw Object.assign(new Error(msg), {
        errorKind: classifyAdapterError(msg, exitCode)
      });
    }
    if (!gotDoneEvent && !signal?.aborted && exitCode === 0) {
      yield {
        type: "done",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { result: finalText }
      };
    }
  }
  return generate();
}
function parseGrokEvent(line, state) {
  if (!line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: { text: line } };
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const type = typeof parsed.type === "string" ? parsed.type : "";
  switch (type) {
    case "thought":
      return null;
    case "text":
      if (typeof parsed.data === "string") {
        state.appendText(parsed.data);
      }
      return null;
    case "tool_call":
    case "tool_use":
      return { type: "tool_call", timestamp, data: parsed };
    case "tool_result":
      return { type: "output", timestamp, data: parsed };
    case "error": {
      const message = typeof parsed.data === "string" ? parsed.data : JSON.stringify(parsed);
      return { type: "error", timestamp, data: parsed, errorKind: classifyAdapterError(message) };
    }
    case "end":
      return { type: "done", timestamp, data: { result: state.finalText(), raw: parsed } };
    default:
      return { type: "output", timestamp, data: parsed };
  }
}

export { GrokAdapter };
//# sourceMappingURL=grok-QFQSWGTD.js.map
//# sourceMappingURL=grok-QFQSWGTD.js.map