import { spawn } from 'child_process';

// src/infrastructure/process/process-manager.ts
var ProcessManager = class {
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err.code === "EPERM") return true;
      return false;
    }
  }
  kill(pid, signal = "SIGTERM") {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
      }
    }
  }
  async killWithGrace(pid, graceMs = 1e4) {
    if (!this.isAlive(pid)) return;
    this.kill(pid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!this.isAlive(pid)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    this.kill(pid, "SIGKILL");
  }
  spawn(command, args, options) {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      // Create new process group so killWithGrace(-pid) kills all children
      ...options
    });
    if (!proc.pid) {
      throw new Error(`Failed to spawn process: ${command}`);
    }
    proc.unref();
    return { process: proc, pid: proc.pid };
  }
};
var MAX_LINE_LEN = 16384;
function capLine(s) {
  return s.length > MAX_LINE_LEN ? s.slice(0, MAX_LINE_LEN) : s;
}
async function* readLines(stream) {
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
        yield capLine(buffer.toString("utf-8", offset, newlineIdx));
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
    yield capLine(final.toString("utf-8"));
  }
}

export { ProcessManager, readLines };
//# sourceMappingURL=chunk-O2MSGW3V.js.map
//# sourceMappingURL=chunk-O2MSGW3V.js.map