import { buildFullPrompt, buildChildEnv } from './chunk-DZTQRHUE.js';
import './chunk-GZVITBV7.js';
import { classifyAdapterError } from './chunk-IESAV453.js';
import { readLines } from './chunk-O2MSGW3V.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

var execFileAsync = promisify(execFile);
var AntigravityAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  kind = "antigravity";
  async test() {
    try {
      const { stdout } = await execFileAsync("agy", ["--version"]);
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "Antigravity CLI not found. Install Google Antigravity CLI and ensure `agy` is on PATH.",
        errorKind: classifyAdapterError(msg)
      };
    }
  }
  execute(params) {
    const args = [
      "-p",
      buildFullPrompt(params.systemPrompt ?? params.config.system_prompt, params.prompt)
    ];
    if (params.security?.allowPermissionBypass) {
      args.push("--dangerously-skip-permissions");
    }
    if (params.config.model) {
      args.push("--model", params.config.model);
    }
    const { process: proc, pid } = this.processManager.spawn("agy", args, {
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal
    });
    const events = createAntigravityEvents(proc, params.signal);
    return { pid, events };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};
function createAntigravityEvents(proc, signal) {
  async function* generate() {
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
    if (proc.stdout) {
      try {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          finalText += finalText ? `
${line}` : line;
          yield {
            type: "output",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            data: { text: line }
          };
        }
      } finally {
        proc.stdout.destroy();
      }
    }
    await exitPromise;
    if (exitError && !signal?.aborted) {
      const spawnErr = exitError;
      throw Object.assign(new Error(spawnErr.message), {
        errorKind: classifyAdapterError(spawnErr.message, exitCode ?? void 0)
      });
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted) {
      const msg = `Antigravity process exited with code ${exitCode}`;
      throw Object.assign(new Error(msg), {
        errorKind: classifyAdapterError(msg, exitCode)
      });
    }
    if (!signal?.aborted) {
      yield {
        type: "done",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { result: finalText }
      };
    }
  }
  return generate();
}

export { AntigravityAdapter };
//# sourceMappingURL=antigravity-NRKD5QGY.js.map
//# sourceMappingURL=antigravity-NRKD5QGY.js.map