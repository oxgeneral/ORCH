import { sanitizeText } from './chunk-RQZGDMFG.js';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import * as yaml from 'js-yaml';

async function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmpPath, content, { encoding: "utf-8", mode: 384 });
    await fs.rename(tmpPath, filePath);
    await fs.chmod(filePath, 384).catch(() => {
    });
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {
    });
    throw err;
  }
}
async function readYaml(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return yaml.load(content);
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}
async function writeYaml(filePath, data) {
  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  });
  await atomicWrite(filePath, content);
}
async function readJson(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}
async function writeJson(filePath, data) {
  const content = JSON.stringify(data, null, 2) + "\n";
  await atomicWrite(filePath, content);
}
var PIPE_BUF = 4096;
async function appendJsonl(filePath, record) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  let line = JSON.stringify(record) + "\n";
  const byteLen = Buffer.byteLength(line, "utf-8");
  if (byteLen > PIPE_BUF && record !== null && typeof record === "object") {
    const obj = record;
    if (typeof obj.data === "string" && obj.data.length > 0) {
      const shell = JSON.stringify({ ...obj, data: "" }) + "\n";
      const overhead = Buffer.byteLength(shell, "utf-8");
      const budget = PIPE_BUF - overhead - 3;
      if (budget > 0) {
        const truncated = obj.data.slice(0, budget);
        line = JSON.stringify({ ...obj, data: truncated + "\u2026" }) + "\n";
      }
    }
  }
  const handle = await getOrCreateHandle(filePath);
  await handle.write(line, null, "utf-8");
}
var HANDLE_IDLE_MS = 1e4;
var appendHandles = /* @__PURE__ */ new Map();
var inFlightOpens = /* @__PURE__ */ new Map();
async function getOrCreateHandle(filePath) {
  const existing = appendHandles.get(filePath);
  if (existing) {
    const now = Date.now();
    if (now - existing.timerSetAt > HANDLE_IDLE_MS / 2) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = setTimeout(() => evictHandle(filePath), HANDLE_IDLE_MS);
      existing.timerSetAt = now;
    }
    return existing.handle;
  }
  let opening = inFlightOpens.get(filePath);
  if (!opening) {
    opening = fs.open(filePath, "a", 384).then((handle) => {
      inFlightOpens.delete(filePath);
      if (appendHandles.has(filePath)) {
        handle.close().catch(() => {
        });
        return appendHandles.get(filePath).handle;
      }
      const entry = {
        handle,
        idleTimer: setTimeout(() => evictHandle(filePath), HANDLE_IDLE_MS),
        timerSetAt: Date.now()
      };
      appendHandles.set(filePath, entry);
      return handle;
    }).catch((err) => {
      inFlightOpens.delete(filePath);
      throw err;
    });
    inFlightOpens.set(filePath, opening);
  }
  return opening;
}
function evictHandle(filePath) {
  const entry = appendHandles.get(filePath);
  if (!entry) return;
  appendHandles.delete(filePath);
  clearTimeout(entry.idleTimer);
  entry.handle.close().catch(() => {
  });
}
function closeAppendHandle(filePath) {
  evictHandle(filePath);
}
function closeAllAppendHandles() {
  for (const filePath of [...appendHandles.keys()]) {
    evictHandle(filePath);
  }
}
process.once("exit", closeAllAppendHandles);
var MAX_JSONL_READ_SIZE = 50 * 1024 * 1024;
async function readJsonl(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_JSONL_READ_SIZE) {
      process.stderr.write(
        `[readJsonl] file too large (${(stat.size / 1024 / 1024).toFixed(1)} MB), reading tail only: ${filePath}
`
      );
      return readJsonlTail(filePath, 200);
    }
    return readAndParseJsonl(filePath);
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}
async function readJsonlTail(filePath, count) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size < 32768) {
      return (await readAndParseJsonl(filePath)).slice(-count);
    }
    const fd = await fs.open(filePath, "r");
    try {
      const chunkSize = Math.min(stat.size, stat.size > 1048576 ? 131072 : 65536);
      let position = Math.max(0, stat.size - chunkSize);
      let earliestReadPosition = position;
      let tail = "";
      for (let attempt = 0; attempt < 4 && position >= 0; attempt++) {
        earliestReadPosition = position;
        const readSize = Math.min(chunkSize, stat.size - position);
        const buf = Buffer.alloc(readSize);
        await fd.read(buf, 0, readSize, position);
        tail = buf.toString("utf-8") + tail;
        const lines2 = tail.split("\n").filter((l) => l.trim().length > 0);
        if (lines2.length >= count + 1) {
          return parseJsonlLines(lines2.slice(-count));
        }
        if (position === 0) break;
        position = Math.max(0, position - chunkSize);
      }
      const lines = tail.split("\n").filter((l) => l.trim().length > 0);
      const safeLines = earliestReadPosition > 0 ? lines.slice(1) : lines;
      return parseJsonlLines(safeLines.slice(-count));
    } finally {
      await fd.close();
    }
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}
async function readAndParseJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  return parseJsonlLines(lines);
}
function parseJsonlLines(lines) {
  const results = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      results.push(JSON.parse(line));
    } catch {
      process.stderr.write(`[readJsonl] skipping corrupt line: ${sanitizeText(line).slice(0, 200)}
`);
    }
  }
  return results;
}
var ensuredDirs = /* @__PURE__ */ new Set();
async function ensureDir(dirPath) {
  if (ensuredDirs.has(dirPath)) return;
  await fs.mkdir(dirPath, { recursive: true, mode: 448 });
  const stat = await fs.lstat(dirPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe directory path: ${dirPath}`);
  }
  ensuredDirs.add(dirPath);
}
async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function listFiles(dirPath, ext) {
  try {
    const entries = await fs.readdir(dirPath);
    if (ext) {
      return entries.filter((e) => e.endsWith(ext));
    }
    return entries;
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}
function isENOENT(err) {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

export { appendJsonl, atomicWrite, closeAppendHandle, ensureDir, listFiles, pathExists, readJson, readJsonl, readJsonlTail, readYaml, writeJson, writeYaml };
//# sourceMappingURL=chunk-54K3JU53.js.map
//# sourceMappingURL=chunk-54K3JU53.js.map