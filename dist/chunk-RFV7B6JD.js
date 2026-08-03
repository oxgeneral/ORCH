import { createTokenUsage } from './chunk-UG72A2JI.js';
import { classifyAdapterError } from './chunk-Z7JNYNWE.js';
import { readLines } from './chunk-UGPJGAIN.js';

// src/infrastructure/adapters/utils.ts
var PARENT_ENV_ALLOWLIST = /* @__PURE__ */ new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "TERM",
  "COLORTERM",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME"
]);
var ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
var EXPLICIT_ENV_DENYLIST = /* @__PURE__ */ new Set([
  "PATH",
  "NODE_PATH",
  "NODE_OPTIONS",
  "BASH_ENV",
  "ENV",
  "GIT_CONFIG",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "PERL5OPT",
  "PERL5LIB"
]);
function isSafeExplicitEnvName(key) {
  const upper = key.toUpperCase();
  return ENV_NAME_RE.test(key) && !EXPLICIT_ENV_DENYLIST.has(upper) && !upper.startsWith("LD_") && !upper.startsWith("DYLD_") && !upper.startsWith("NPM_CONFIG_") && !upper.startsWith("GIT_CONFIG_KEY_") && !upper.startsWith("GIT_CONFIG_VALUE_");
}
function buildFullPrompt(systemPrompt, userPrompt) {
  return systemPrompt ? systemPrompt + "\n\n" + userPrompt : userPrompt;
}
function buildChildEnv(explicitEnv, extraEnv) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if ((PARENT_ENV_ALLOWLIST.has(key) || key.startsWith("LC_")) && value !== void 0) {
      env[key] = value;
    }
  }
  for (const source of [explicitEnv, extraEnv]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (isSafeExplicitEnvName(key)) env[key] = value;
    }
  }
  return env;
}
function extractTokens(parsed, opts) {
  let usage = parsed.usage;
  if (!usage && opts?.statsFallback) {
    const stats = parsed.stats;
    usage = stats?.usage;
  }
  if (usage && typeof usage.input_tokens === "number") {
    const input = usage.input_tokens;
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    const reasoning = typeof usage.reasoning_tokens === "number" ? usage.reasoning_tokens : 0;
    const cache_read = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
    const cache_write = typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
    return createTokenUsage(input, output, { reasoning, cache_read, cache_write });
  }
  return void 0;
}
function createStreamingEvents(proc, parseEvent, adapterName, signal) {
  async function* generate() {
    let gotDoneEvent = false;
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
          const event = parseEvent(line);
          if (event) {
            if (event.type === "done") gotDoneEvent = true;
            yield event;
          }
        }
      } finally {
        proc.stdout.destroy();
      }
    }
    await exitPromise;
    if (exitError && !signal?.aborted && !gotDoneEvent) {
      const spawnErr = exitError;
      const classified = classifyAdapterError(spawnErr.message, exitCode ?? void 0);
      const err = Object.assign(new Error(spawnErr.message), { errorKind: classified });
      throw err;
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const msg = `${adapterName} process exited with code ${exitCode}`;
      const classified = classifyAdapterError(msg, exitCode);
      const err = Object.assign(new Error(msg), { errorKind: classified });
      throw err;
    }
  }
  return generate();
}

export { buildChildEnv, buildFullPrompt, createStreamingEvents, extractTokens };
//# sourceMappingURL=chunk-RFV7B6JD.js.map
//# sourceMappingURL=chunk-RFV7B6JD.js.map