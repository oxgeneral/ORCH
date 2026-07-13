import { buildChildEnv } from './chunk-T43AHB5M.js';
import './chunk-GZVITBV7.js';
import { classifyAdapterError } from './chunk-IESAV453.js';
import { readLines } from './chunk-UGPJGAIN.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

// src/infrastructure/adapters/event-buffer.ts
var DEFAULT_CAPACITY = 1024;
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
var EventBuffer = class {
  buf;
  head = 0;
  // read index
  tail = 0;
  // write index
  count = 0;
  capacity;
  // Consumer notification: resolved when new data is available
  dataReady = null;
  // Producer notification: resolved when space is available
  spaceReady = null;
  closed = false;
  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }
  /** Number of buffered events. */
  get size() {
    return this.count;
  }
  get isFull() {
    return this.count >= this.capacity;
  }
  /**
   * Push an event into the buffer.
   * If the buffer is full, waits until space is available (backpressure).
   */
  async push(event) {
    while (this.isFull && !this.closed) {
      if (!this.spaceReady) {
        this.spaceReady = deferred();
      }
      await this.spaceReady.promise;
    }
    if (this.closed) return;
    this.buf[this.tail] = event;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    if (this.dataReady) {
      const dr = this.dataReady;
      this.dataReady = null;
      dr.resolve();
    }
  }
  /**
   * Dequeue the next event. O(1).
   * Returns undefined only when buffer is empty AND closed.
   */
  async take() {
    while (this.count === 0) {
      if (this.closed) return void 0;
      if (!this.dataReady) {
        this.dataReady = deferred();
      }
      await this.dataReady.promise;
    }
    const event = this.buf[this.head];
    this.buf[this.head] = void 0;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    if (this.spaceReady) {
      const sr = this.spaceReady;
      this.spaceReady = null;
      sr.resolve();
    }
    return event;
  }
  /**
   * Signal that no more events will be pushed.
   * Wakes up any waiting consumer/producer.
   */
  close() {
    this.closed = true;
    if (this.dataReady) {
      const dr = this.dataReady;
      this.dataReady = null;
      dr.resolve();
    }
    if (this.spaceReady) {
      const sr = this.spaceReady;
      this.spaceReady = null;
      sr.resolve();
    }
  }
  get isClosed() {
    return this.closed;
  }
  /**
   * Async iterator that drains the buffer until closed and empty.
   */
  async *[Symbol.asyncIterator]() {
    while (true) {
      const event = await this.take();
      if (event === void 0) return;
      yield event;
    }
  }
};
var execFileAsync = promisify(execFile);
var ShellAdapter = class {
  constructor(processManager) {
    this.processManager = processManager;
  }
  kind = "shell";
  async test() {
    try {
      const { stdout } = await execFileAsync("bash", ["--version"]);
      const version = stdout.split("\n")[0]?.trim() ?? "unknown";
      return { ok: true, version };
    } catch {
      return { ok: false, error: "bash not found", errorKind: classifyAdapterError("bash not found") };
    }
  }
  execute(params) {
    if (params.security?.allowShellAdapter !== true) {
      async function* errorGen() {
        const err = Object.assign(
          new Error("Shell adapter is disabled. Set execution.security.allow_shell_adapter=true to opt in."),
          { errorKind: "spawn_failed" /* SPAWN_FAILED */ }
        );
        throw err;
      }
      return { pid: 0, events: errorGen() };
    }
    const command = params.config.command;
    if (!command) {
      async function* errorGen() {
        const err = Object.assign(
          new Error("Shell adapter requires a command in agent config"),
          { errorKind: "spawn_failed" /* SPAWN_FAILED */ }
        );
        throw err;
      }
      return { pid: 0, events: errorGen() };
    }
    const { process: proc, pid } = this.processManager.spawn("bash", ["-lc", command], {
      cwd: params.workspace,
      env: buildChildEnv(params.env),
      signal: params.signal
    });
    const signal = params.signal;
    const processManager = this.processManager;
    const exitPromise = new Promise((resolve, reject) => {
      proc.on("close", (code) => {
        if (code === 0 || signal?.aborted) {
          resolve();
        } else {
          reject(new Error(`Shell command exited with code ${code}`));
        }
      });
      proc.on("error", reject);
    });
    async function* generateEvents() {
      const buffer = new EventBuffer();
      const onAbort = () => {
        processManager.killWithGrace(pid, 5e3).catch(() => {
        });
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
      const stdoutPromise = (async () => {
        if (!proc.stdout) return;
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          await buffer.push({
            type: "output",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            data: line
          });
        }
      })();
      const stderrPromise = (async () => {
        if (!proc.stderr) return;
        for await (const line of readLines(proc.stderr)) {
          if (signal?.aborted) break;
          await buffer.push({
            type: "error",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            data: line,
            errorKind: classifyAdapterError(line)
          });
        }
      })();
      void Promise.all([stdoutPromise, stderrPromise]).then(
        () => buffer.close(),
        () => buffer.close()
      );
      yield* buffer;
      if (signal && !signal.aborted) {
        signal.removeEventListener("abort", onAbort);
      }
      await exitPromise;
    }
    return { pid, events: generateEvents() };
  }
  async stop(pid) {
    await this.processManager.killWithGrace(pid);
  }
};

export { ShellAdapter };
//# sourceMappingURL=shell-3O5OB3RT.js.map
//# sourceMappingURL=shell-3O5OB3RT.js.map