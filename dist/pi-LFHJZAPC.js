import { buildChildEnv } from './chunk-AAD6WJ7E.js';
import { createTokenUsage } from './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-BBYWS5VU.js';
import './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';

var PiAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  kind = "pi";
  async test() {
    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile("pi", ["--version"], (err, out) => {
          if (err) reject(err);
          else resolve(out);
        });
      });
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Pi CLI not found. Install: npm i -g @mariozechner/pi-coding-agent",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    const args = [
      "--mode",
      "rpc"
    ];
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    if (params.config.effort) {
      args.push("--thinking", params.config.effort);
    }
    const effectiveSystemPrompt = params.systemPrompt ?? params.config.system_prompt;
    if (effectiveSystemPrompt) {
      args.push("--append-system-prompt", effectiveSystemPrompt);
    }
    const { process: proc, pid } = this.processManager.spawn("pi", args, {
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stderrTail = createStderrTailCapture(proc.stderr);
    if (proc.stdin) {
      proc.stdin.write(JSON.stringify({
        id: `orch-${Date.now()}`,
        type: "prompt",
        message: params.prompt
      }) + "\n");
    }
    const events = createPiRpcEvents(proc, pid, this.processManager, stderrTail, params.signal);
    return { pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function createPiRpcEvents(proc, pid, processManager, stderrTail, signal) {
  async function* generate() {
    let gotDoneEvent = false;
    let streamErrorYielded = false;
    let finalText = "";
    let lastTokens;
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
    let streamError = null;
    try {
      if (proc.stdout) {
        try {
          for await (const line of readPiRpcLines(proc.stdout)) {
            if (signal?.aborted) break;
            const event = parsePiRpcEvent(line, { finalText, lastTokens });
            if (!event) continue;
            if (event.finalText !== void 0) finalText = event.finalText;
            if (event.tokens) lastTokens = event.tokens;
            if (event.agentEvent) {
              if (event.agentEvent.type === "done") gotDoneEvent = true;
              yield event.agentEvent;
              if (event.agentEvent.type === "done") {
                await processManager.killWithGrace(pid, 1e3).catch(() => {
                });
                return;
              }
            }
          }
        } catch (err) {
          streamError = err instanceof Error ? err : new Error(String(err));
          if (!signal?.aborted && !gotDoneEvent) {
            streamErrorYielded = true;
            yield {
              type: "error",
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              data: { message: streamError.message },
              errorKind: classifyAdapterError(streamError.message)
            };
          }
        }
      }
    } finally {
      proc.stdout?.destroy();
      if (!gotDoneEvent && (signal?.aborted || streamError)) {
        processManager.killWithGrace(pid, 1e3).catch(() => {
        });
      }
    }
    await exitPromise;
    if (streamErrorYielded) return;
    const spawnError = exitError;
    if (spawnError && !signal?.aborted && !gotDoneEvent) {
      const message = appendStderrTail(spawnError.message, stderrTail());
      const classified = classifyAdapterError(message, exitCode ?? void 0);
      throw Object.assign(new Error(message), { errorKind: classified });
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const baseMsg = `Pi process exited with code ${exitCode}`;
      const message = appendStderrTail(baseMsg, stderrTail());
      const classified = classifyAdapterError(message, exitCode);
      throw Object.assign(new Error(message), { errorKind: classified });
    }
  }
  return generate();
}
function appendStderrTail(message, tail) {
  return tail ? `${message}
--- pi stderr (tail) ---
${tail}` : message;
}
function parsePiRpcEvent(line, state) {
  if (!line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { agentEvent: { type: "output", timestamp: (/* @__PURE__ */ new Date()).toISOString(), data: { text: line } } };
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const type = typeof parsed.type === "string" ? parsed.type : "";
  switch (type) {
    case "extension_ui_request":
    case "agent_start":
    case "turn_start":
    case "message_start":
    case "message_end":
    case "turn_end":
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
      return extractPassiveUpdate(parsed);
    case "response": {
      if (parsed.success === false) {
        const message = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed);
        return {
          agentEvent: { type: "error", timestamp, data: { message, raw: parsed }, errorKind: classifyAdapterError(message) }
        };
      }
      return null;
    }
    case "message_update":
      return parseMessageUpdate(parsed, timestamp, state);
    case "tool_execution_start":
      return {
        agentEvent: {
          type: "tool_call",
          timestamp,
          data: { name: parsed.toolName, input: parsed.args, raw: parsed }
        }
      };
    case "tool_execution_update":
      return null;
    case "tool_execution_end":
      return parseToolExecutionEnd(parsed, timestamp);
    case "agent_end": {
      const final = extractFinalText(parsed) ?? state.finalText;
      const tokens = extractPiTokensFromAgentEnd(parsed) ?? state.lastTokens;
      return {
        finalText: final,
        tokens,
        agentEvent: {
          type: "done",
          timestamp,
          data: { result: final, raw: parsed },
          tokens
        }
      };
    }
    case "extension_error": {
      const message = typeof parsed.message === "string" ? parsed.message : JSON.stringify(parsed);
      return {
        agentEvent: { type: "error", timestamp, data: { message, raw: parsed }, errorKind: classifyAdapterError(message) }
      };
    }
    default:
      return null;
  }
}
function parseMessageUpdate(parsed, timestamp, state) {
  const assistantMessageEvent = parsed.assistantMessageEvent;
  const updateType = typeof assistantMessageEvent?.type === "string" ? assistantMessageEvent.type : "";
  if (updateType === "text_delta") {
    const delta = typeof assistantMessageEvent?.delta === "string" ? assistantMessageEvent.delta : "";
    return { finalText: state.finalText + delta };
  }
  if (updateType === "text_end") {
    const content = typeof assistantMessageEvent?.content === "string" ? assistantMessageEvent.content : state.finalText;
    if (!content) return { finalText: "" };
    return {
      finalText: "",
      agentEvent: { type: "output", timestamp, data: { text: content } }
    };
  }
  if (updateType === "error") {
    const reason = typeof assistantMessageEvent?.reason === "string" ? assistantMessageEvent.reason : JSON.stringify(parsed);
    return {
      agentEvent: { type: "error", timestamp, data: { message: reason, raw: parsed }, errorKind: classifyAdapterError(reason) }
    };
  }
  return null;
}
function parseToolExecutionEnd(parsed, timestamp) {
  const toolName = typeof parsed.toolName === "string" ? parsed.toolName : "";
  const args = parsed.args;
  const resultText = extractToolResultText(parsed.result);
  if (parsed.isError === true) {
    const message = resultText || JSON.stringify(parsed.result ?? parsed);
    return {
      agentEvent: { type: "error", timestamp, data: { message, raw: parsed }, errorKind: classifyAdapterError(message) }
    };
  }
  if (toolName === "bash") {
    const command = typeof args?.command === "string" ? args.command : JSON.stringify(args ?? {});
    return {
      agentEvent: {
        type: "command",
        timestamp,
        data: { command, result: resultText, raw: parsed }
      }
    };
  }
  if (/^(write|edit)$/i.test(toolName)) {
    const path = extractPath(args);
    if (path) {
      return {
        agentEvent: {
          type: "file_change",
          timestamp,
          data: { paths: [path], raw: parsed }
        }
      };
    }
  }
  const summary = resultText || `${toolName || "tool"} completed`;
  return { agentEvent: { type: "output", timestamp, data: { text: summary, raw: parsed } } };
}
function extractToolResultText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  return extractTextFromContent(result.content) ?? "";
}
function extractPassiveUpdate(parsed) {
  const tokens = extractPiTokensFromMessage(parsed);
  return tokens ? { tokens } : null;
}
function extractFinalText(parsed) {
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return void 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const text = extractTextFromContent(message.content);
    if (text) return text;
  }
  return void 0;
}
function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return void 0;
  const parts = content.map((part) => {
    const p = part;
    return typeof p.text === "string" ? p.text : "";
  }).filter(Boolean);
  return parts.length ? parts.join("") : void 0;
}
function extractPath(args) {
  if (!args) return void 0;
  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  return void 0;
}
function extractPiTokensFromAgentEnd(parsed) {
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return void 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const tokens = extractPiTokensFromMessage(message);
    if (tokens) return tokens;
  }
  return void 0;
}
var PI_TOKEN_ALIASES = {
  input: ["input", "input_tokens"],
  output: ["output", "output_tokens"],
  reasoning: ["reasoning", "reasoning_tokens"],
  cache_read: ["cacheRead", "cache_read", "cache_read_input_tokens"],
  cache_write: ["cacheWrite", "cache_write", "cache_creation_input_tokens"]
};
function extractPiTokensFromMessage(parsed) {
  const usage = parsed.usage;
  if (!usage) return void 0;
  const pick = (keys) => {
    for (const k of keys) {
      const v = usage[k];
      if (typeof v === "number") return v;
    }
    return 0;
  };
  const input = pick(PI_TOKEN_ALIASES.input);
  const output = pick(PI_TOKEN_ALIASES.output);
  const reasoning = pick(PI_TOKEN_ALIASES.reasoning);
  const cache_read = pick(PI_TOKEN_ALIASES.cache_read);
  const cache_write = pick(PI_TOKEN_ALIASES.cache_write);
  if (input === 0 && output === 0 && reasoning === 0 && cache_read === 0 && cache_write === 0) return void 0;
  return createTokenUsage(input, output, { reasoning, cache_read, cache_write });
}
var STDERR_TAIL_BYTES = 4096;
function createStderrTailCapture(stderr) {
  if (!stderr) return () => "";
  let buf = Buffer.alloc(0);
  stderr.on("data", (chunk) => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
    buf = buf.length === 0 ? next : Buffer.concat([buf, next], buf.length + next.length);
    if (buf.length > STDERR_TAIL_BYTES) {
      buf = Buffer.from(buf.subarray(buf.length - STDERR_TAIL_BYTES));
    }
  });
  stderr.on("error", () => {
  });
  return () => buf.toString("utf-8").trimEnd();
}
async function* readPiRpcLines(stream) {
  const chunks = [];
  let totalLen = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
    if (buf.length === 0) continue;
    chunks.push(buf);
    totalLen += buf.length;
    const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalLen);
    chunks.length = 0;
    totalLen = 0;
    let offset = 0;
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf(10, offset)) !== -1) {
      if (newlineIdx > offset) {
        const line = buffer.toString("utf-8", offset, newlineIdx);
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
      }
      offset = newlineIdx + 1;
    }
    if (offset < buffer.length) {
      const remainder = buffer.subarray(offset);
      chunks.push(remainder);
      totalLen = remainder.length;
    }
  }
  if (totalLen > 0) {
    const final = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalLen);
    const line = final.toString("utf-8");
    if (line) yield line.endsWith("\r") ? line.slice(0, -1) : line;
  }
}

export { PiAdapter };
//# sourceMappingURL=pi-LFHJZAPC.js.map
//# sourceMappingURL=pi-LFHJZAPC.js.map