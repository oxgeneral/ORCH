# Daemon Mode Architecture

> RFC · Status: **Draft** · Priority: P3 · Author: Backend A · Date: 2026-03-15

## 1. Problem Statement

Current CLI response times are bounded by Node.js process startup overhead:

```
Total wall time      = Node startup + ESM resolve + Container init + Command work
orch task list       =     30ms     +     8ms     +      10ms     +     7ms      = 55ms
orch --version       =     30ms     +     8ms     +       0ms     +     0ms      = 38ms
```

The **38ms Node.js floor** (V8 init + ESM loader) is irreducible in the current architecture.
Even with all application work optimized to near-zero, CLI can never go below 38ms.

**Target**: Sub-10ms responses for read commands (`task list`, `agent list`, `msg inbox`, etc.)

## 2. Solution: Daemon + Thin Client

Split the CLI into two processes:

```
┌─────────────────────┐     Unix Socket      ┌──────────────────────────────┐
│   orch (thin client) │ ──── IPC ──────────→ │   orchd (daemon)              │
│   ~2KB binary        │ ← JSON response ──── │   warm Node.js + Container    │
│   Written in C/Rust  │                      │   fs.watch() for invalidation │
│   or Node.js script  │                      │   Auto-shutdown on idle       │
└─────────────────────┘                       └──────────────────────────────┘
         5-10ms                                     Always warm (~20MB RSS)
```

### Why This Works

| Component | Current (per-invocation) | Daemon mode |
|-----------|------------------------|-------------|
| Node.js startup | 30ms | 0ms (already running) |
| ESM module resolution | 8ms | 0ms (already loaded) |
| Container build | 10ms | 0ms (already built) |
| Index cache read | 3ms | 0ms (in-memory, fs.watch invalidated) |
| Command execution | 4ms | 4ms (same) |
| IPC overhead | 0ms | ~1-2ms (Unix socket) |
| **Total** | **55ms** | **5-10ms** |

## 3. Architecture

### 3.1 Daemon Process (`src/daemon/server.ts`)

```
src/daemon/
├── server.ts          # net.createServer() on Unix socket
├── router.ts          # Maps RPC method → service call
├── protocol.ts        # JSON-RPC 2.0 message types
├── lifecycle.ts       # Auto-start, idle shutdown, health check
└── watcher.ts         # fs.watch() → cache invalidation
```

The daemon:
1. Starts on first `orch` invocation (auto-spawn)
2. Builds `LightContainer` once, keeps it warm in memory
3. Listens on a Unix domain socket: `.orchestry/daemon.sock`
4. Maintains in-memory index caches (tasks, agents, goals, messages, contexts)
5. Uses `fs.watch()` to invalidate caches when files change on disk
6. Auto-shuts down after configurable idle timeout (default: 30 minutes)
7. Writes PID to `.orchestry/daemon.pid` for lifecycle management

### 3.2 Thin Client (`src/daemon/client.ts`)

The CLI detects if a daemon is running and routes through it:

```typescript
// In cli.ts, before container build:
const daemonResult = await tryDaemonCall(sub, args);
if (daemonResult) {
  process.stdout.write(daemonResult.output);
  process.exit(daemonResult.exitCode);
}
// Fallback: build container directly (daemon not running or unavailable)
```

**Fallback guarantee**: If daemon is not running, unresponsive, or returns an error,
the CLI falls back to the current direct-execution path. Zero behavior change.

### 3.3 Protocol: JSON-RPC 2.0 over Unix Socket

```typescript
// Request (client → daemon)
interface DaemonRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;           // e.g., 'task.list', 'agent.list', 'msg.inbox'
  params: Record<string, unknown>;
}

// Response (daemon → client)
interface DaemonResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    output: string;         // Formatted stdout content
    exitCode: number;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
```

**Why JSON-RPC 2.0?**
- Standard protocol, well-understood
- Supports batching (future: `orch task list && orch agent list` in one round trip)
- Error codes are standardized
- Simple to implement (~50 LOC parser)

**Why Unix domain socket (not TCP/HTTP)?**
- No port conflicts
- Filesystem permissions (same-user only)
- ~2x faster than TCP loopback (no TCP handshake)
- Auto-cleanup: socket file removed on daemon shutdown
- Project-scoped: `.orchestry/daemon.sock` per project root

### 3.4 Supported Methods (Phase 1: Read-Only)

All `LightContainer` commands that only read data:

| Method | CLI equivalent | Service call |
|--------|---------------|--------------|
| `task.list` | `orch task list` | `taskService.list(filter)` |
| `task.show` | `orch task show <id>` | `taskStore.get(id)` |
| `agent.list` | `orch agent list` | `agentService.list()` |
| `agent.show` | `orch agent show <id>` | `agentStore.get(id)` |
| `msg.inbox` | `orch msg inbox <id>` | `messageService.listPendingForAgent(id)` |
| `msg.list` | `orch msg list` | `messageStore.list()` |
| `context.list` | `orch context list` | `contextStore.list()` |
| `context.get` | `orch context get <k>` | `contextStore.get(key)` |
| `goal.list` | `orch goal list` | `goalService.list()` |
| `team.list` | `orch team list` | `teamStore.list()` |
| `status` | `orch status` | `stateStore.read()` |

Phase 2 (future): Write operations (`task add`, `agent add`, `msg send`, `context set`).
Phase 3 (future): Full container methods (`run`, `doctor`).

### 3.5 Cache Invalidation via fs.watch()

```typescript
// watcher.ts
class DaemonWatcher {
  private watchers = new Map<string, fs.FSWatcher>();

  watch(paths: Paths): void {
    // Watch each store directory for changes
    this.addWatch(paths.tasksDir,    () => this.invalidate('tasks'));
    this.addWatch(paths.agentsDir,   () => this.invalidate('agents'));
    this.addWatch(paths.messagesDir, () => this.invalidate('messages'));
    this.addWatch(paths.contextsDir, () => this.invalidate('contexts'));
    this.addWatch(paths.goalsDir,    () => this.invalidate('goals'));
    this.addWatch(paths.teamsDir,    () => this.invalidate('teams'));
    this.addWatch(paths.statePath,   () => this.invalidate('state'));
  }

  private invalidate(store: string): void {
    // Debounced: coalesce rapid file changes (e.g., orchestrator tick)
    // Re-read _index.json on next request for this store
    this.dirtyStores.add(store);
  }
}
```

**Key design decisions:**
- **Lazy re-read**: Don't re-read on every fs event. Mark dirty, re-read on next request.
- **Debounce**: 50ms window to coalesce rapid writes (orchestrator tick writes multiple files).
- **Granular**: Per-store invalidation, not global. A task change doesn't invalidate agent cache.

### 3.6 Daemon Lifecycle

```
                    ┌─────────────┐
                    │  Not Running │
                    └──────┬──────┘
                           │ orch <cmd> (no daemon.sock)
                           ▼
                    ┌─────────────┐
     ┌──────────────│   Starting   │
     │              └──────┬──────┘
     │ spawn error         │ socket listening
     │ (fallback to        ▼
     │  direct exec)  ┌─────────────┐
     │                │   Running    │ ◄── handles RPC requests
     │                └──────┬──────┘
     │                       │ idle timeout (30min) / SIGTERM / orch daemon stop
     │                       ▼
     │                ┌─────────────┐
     └───────────────→│   Stopped    │ → unlink daemon.sock + daemon.pid
                      └─────────────┘
```

#### Auto-Start (transparent to user)

```typescript
// client.ts
async function tryDaemonCall(method: string, params: unknown): Promise<DaemonResult | null> {
  const sockPath = path.join(projectRoot, '.orchestry', 'daemon.sock');

  // 1. Try to connect to existing daemon
  try {
    return await rpcCall(sockPath, method, params, { timeout: 500 });
  } catch {
    // Not running or unresponsive
  }

  // 2. Spawn daemon in background
  const daemonBin = path.join(__dirname, '../daemon/server.js');
  const child = spawn(process.execPath, [daemonBin, projectRoot], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // 3. Wait for socket to appear (max 2s)
  await waitForSocket(sockPath, 2000);

  // 4. Retry RPC call
  try {
    return await rpcCall(sockPath, method, params, { timeout: 500 });
  } catch {
    return null; // Fallback to direct execution
  }
}
```

#### Idle Shutdown

```typescript
// lifecycle.ts
class IdleTracker {
  private timer: NodeJS.Timeout | null = null;
  private readonly timeoutMs: number;

  constructor(timeoutMs = 30 * 60 * 1000) { // 30 min default
    this.timeoutMs = timeoutMs;
  }

  touch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.shutdown(), this.timeoutMs);
  }

  private shutdown(): void {
    // Clean up: unlink socket, unlink PID file, exit
    process.exit(0);
  }
}
```

#### Explicit Control

```bash
orch daemon start    # Start daemon manually
orch daemon stop     # Stop daemon gracefully
orch daemon status   # Show daemon status (PID, uptime, memory, cache stats)
orch daemon restart  # Restart (re-read config, rebuild container)
```

### 3.7 Configuration

Add to `config.yml`:

```yaml
daemon:
  enabled: true              # Enable daemon mode (default: true)
  idle_timeout_ms: 1800000   # Auto-shutdown after 30min idle (0 = never)
  socket_path: auto          # 'auto' = .orchestry/daemon.sock
```

Add to `global.yml` (user-level override):

```yaml
daemon:
  enabled: false             # Disable daemon globally
```

## 4. Implementation Plan

### Phase 1: Core Daemon + Read Commands (P3, ~3 days)

#### 4.1 Domain Layer

New file: `src/domain/daemon.ts`
```typescript
export interface DaemonConfig {
  enabled: boolean;
  idle_timeout_ms: number;
  socket_path: 'auto' | string;
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  enabled: true,
  idle_timeout_ms: 30 * 60 * 1000,
  socket_path: 'auto',
};
```

#### 4.2 Infrastructure Layer

**`src/daemon/protocol.ts`** — JSON-RPC 2.0 types + message framing

Uses newline-delimited JSON (NDJSON) for framing — each message is one line terminated by `\n`.
Simple, no length-prefix complexity, works with `readline` or manual split.

```typescript
export interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC_ERRORS = {
  PARSE_ERROR:      -32700,
  INVALID_REQUEST:  -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS:   -32602,
  INTERNAL_ERROR:   -32603,
} as const;

export function encodeMessage(msg: RpcRequest | RpcResponse): Buffer {
  return Buffer.from(JSON.stringify(msg) + '\n');
}

export function parseMessage(line: string): RpcRequest | RpcResponse {
  return JSON.parse(line) as RpcRequest | RpcResponse;
}
```

**`src/daemon/server.ts`** — net.createServer on Unix socket

```typescript
import net from 'node:net';
import { buildLightContainer } from '../container.js';
import { createContext } from '../cli/context.js';
import { DaemonRouter } from './router.js';
import { DaemonWatcher } from './watcher.js';
import { IdleTracker } from './lifecycle.js';
import { encodeMessage, parseMessage, RPC_ERRORS } from './protocol.js';

export class DaemonServer {
  private server: net.Server | null = null;
  private container: LightContainer | null = null;
  private watcher: DaemonWatcher;
  private idle: IdleTracker;
  private router: DaemonRouter;

  async start(projectRoot: string, config: DaemonConfig): Promise<void> {
    // 1. Build container once
    const context = createContext({});
    this.container = await buildLightContainer(context);
    this.router = new DaemonRouter(this.container);

    // 2. Start file watcher for cache invalidation
    this.watcher = new DaemonWatcher(this.container.paths);
    this.watcher.start();

    // 3. Start idle tracker
    this.idle = new IdleTracker(config.idle_timeout_ms);
    this.idle.touch();

    // 4. Listen on Unix socket
    const sockPath = this.resolveSockPath(projectRoot, config);
    await this.cleanStaleSocket(sockPath);
    this.server = net.createServer((conn) => this.handleConnection(conn));
    this.server.listen(sockPath);

    // 5. Write PID file
    await this.writePidFile(projectRoot);

    // 6. Graceful shutdown
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  private handleConnection(conn: net.Socket): void {
    this.idle.touch();
    let buffer = '';

    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleMessage(conn, line);
      }
    });
  }

  private async handleMessage(conn: net.Socket, line: string): Promise<void> {
    try {
      const req = parseMessage(line) as RpcRequest;
      const result = await this.router.dispatch(req.method, req.params ?? {});
      conn.write(encodeMessage({ jsonrpc: '2.0', id: req.id, result }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      conn.write(encodeMessage({
        jsonrpc: '2.0', id: 0,
        error: { code: RPC_ERRORS.INTERNAL_ERROR, message: msg },
      }));
    }
  }

  async stop(): Promise<void> {
    this.watcher?.stop();
    this.server?.close();
    // Cleanup sock + pid files
  }
}
```

**`src/daemon/router.ts`** — Method dispatch

```typescript
export class DaemonRouter {
  private handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();

  constructor(container: LightContainer) {
    // Read-only methods
    this.register('task.list',     (p) => container.taskService.list(p.filter));
    this.register('task.show',     (p) => container.taskStore.get(p.id as string));
    this.register('agent.list',    ()  => container.agentService.list());
    this.register('agent.show',    (p) => container.agentStore.get(p.id as string));
    this.register('msg.inbox',     (p) => container.messageService.listPendingForAgent(p.agentId as string));
    this.register('msg.list',      ()  => container.messageStore.list());
    this.register('context.list',  ()  => container.contextStore.list());
    this.register('context.get',   (p) => container.contextStore.get(p.key as string));
    this.register('goal.list',     ()  => container.goalService.list());
    this.register('team.list',     ()  => container.teamStore.list());
    this.register('status',        ()  => container.stateStore.read());
    this.register('ping',          ()  => Promise.resolve({ ok: true, uptime: process.uptime() }));
  }

  async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) throw new MethodNotFoundError(method);
    return handler(params);
  }
}
```

**`src/daemon/client.ts`** — Thin client for CLI integration

```typescript
import net from 'node:net';
import { encodeMessage, parseMessage } from './protocol.js';
import type { RpcResponse } from './protocol.js';

export async function daemonRpc(
  sockPath: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 500,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sockPath);
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error('Daemon timeout'));
    }, timeoutMs);

    let buffer = '';

    conn.on('connect', () => {
      conn.write(encodeMessage({ jsonrpc: '2.0', id: 1, method, params }));
    });

    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;

      clearTimeout(timer);
      const line = buffer.slice(0, idx);
      conn.end();

      const resp = parseMessage(line) as RpcResponse;
      if (resp.error) reject(new Error(resp.error.message));
      else resolve(resp.result);
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function getDaemonSockPath(projectRoot: string): string {
  return path.join(projectRoot, '.orchestry', 'daemon.sock');
}
```

#### 4.3 CLI Integration

Minimal change to `src/bin/cli.ts`:

```typescript
// After context creation, before container build:
if (sub && sub in LIGHT_COMMANDS && !isHelpOrVersion) {
  const { tryDaemonCall } = await import('../daemon/client.js');
  const result = await tryDaemonCall(context.projectRoot, sub, process.argv);
  if (result !== null) {
    if (result.output) process.stdout.write(result.output);
    process.exit(result.exitCode);
  }
  // Daemon unavailable — fall through to normal path
}
```

### Phase 2: Write Commands (future)

Add write methods to the router:
- `task.add`, `task.update`, `task.delete`
- `agent.add`, `agent.update`, `agent.delete`
- `msg.send`, `msg.broadcast`
- `context.set`, `context.delete`

Write operations invalidate the affected in-memory cache immediately (no need to wait for fs.watch).

### Phase 3: Full Container (future)

Upgrade daemon to optionally hold a `FullContainer`:
- `run` command sends task ID to daemon, daemon spawns adapter processes
- TUI connects to daemon's EventBus over the socket (streaming RPC)
- `doctor` runs diagnostics through daemon

## 5. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Unauthorized access | Unix socket — same-user only (filesystem permissions 0600) |
| Path traversal | Socket scoped to `.orchestry/` — one daemon per project |
| Stale daemon | PID file + health check. Client validates PID alive before connecting. |
| Resource exhaustion | Idle timeout auto-shutdown. Max concurrent connections (default: 10). |
| Socket file leak | Cleanup on shutdown + stale socket detection (connect-or-unlink). |
| Data consistency | fs.watch invalidation + lazy re-read. Writes go through same stores. |

## 6. Performance Budget

```
Client (thin):
  Parse args              ~0.1ms   (string split)
  Connect Unix socket     ~0.5ms   (syscall)
  Send JSON-RPC request   ~0.1ms   (serialize + write)
  Wait for response       ~3-5ms   (daemon processing)
  Write stdout            ~0.1ms
  ─────────────────────────────────
  Total                    4-6ms

Daemon (per-request):
  Parse JSON-RPC          ~0.1ms
  Route to handler        ~0.01ms
  Read from memory cache  ~0.1ms   (index already in RAM)
  Format response         ~0.5ms   (JSON.stringify)
  ─────────────────────────────────
  Total                   ~1ms     (cache hit)
  Total                   ~5ms     (cache miss — re-read index from disk)
```

**Caveat**: If using Node.js as the thin client, add ~38ms for Node startup.
For true sub-10ms, the client should be:
- A compiled binary (Rust/C/Go) — adds ~1MB to install, but ~1ms startup
- Or a shell script using `socat`/`nc` — zero-install, ~2-3ms startup
- Or reuse a running Node.js process (e.g., shell integration, IDE plugin)

**Recommended approach**: Ship a Node.js client as default (still saves ~17ms for light commands).
Optionally compile a native client for users who want sub-10ms.

## 7. Alternative Client Implementations

### 7.1 Node.js Client (Default)

```
node dist/daemon/client.js task list
```
- Startup: ~38ms (Node floor) + 2ms IPC = ~40ms
- Savings: 15ms vs current 55ms (for `task list`)
- Pro: Zero additional dependencies, same build pipeline
- Con: Still bounded by Node.js startup

### 7.2 Shell Script Client (`orch-fast`)

```bash
#!/bin/sh
# Thin client using socat for Unix socket communication
SOCK=".orchestry/daemon.sock"
REQ='{"jsonrpc":"2.0","id":1,"method":"'"$1"'","params":{}}'
echo "$REQ" | socat - UNIX-CONNECT:"$SOCK" 2>/dev/null
```
- Startup: ~3-5ms
- Pro: No compilation, works everywhere with `socat`
- Con: JSON parsing in shell is fragile; formatting lost

### 7.3 Compiled Native Client (Rust)

```rust
// ~50 LOC Rust client
fn main() {
    let sock = UnixStream::connect(".orchestry/daemon.sock").unwrap();
    // Send JSON-RPC, read response, print output
}
```
- Startup: ~1-2ms
- Pro: True sub-10ms, single binary
- Con: Requires Rust toolchain in CI, adds install complexity

### Recommendation

Start with **Node.js client** (Phase 1). This already saves 15ms and requires zero new tooling.
If demand exists for sub-10ms, add optional `orch-fast` shell script (Phase 1.5) or Rust binary (Phase 2).

## 8. Compatibility & Migration

### Backward Compatibility

- **Zero breaking changes**: Daemon mode is opt-in via `config.yml`
- **Transparent fallback**: If daemon is unavailable, CLI works exactly as today
- **Same output format**: Daemon returns the same formatted output as direct execution
- **Same exit codes**: Error codes are preserved through IPC

### `.gitignore` Update

Add to `.orchestry/.gitignore`:
```
daemon.sock
daemon.pid
```

### Testing Strategy

```
test/unit/daemon/
├── protocol.test.ts     # JSON-RPC encode/decode, framing
├── router.test.ts       # Method dispatch, error handling
├── server.test.ts       # Socket lifecycle, connection handling
├── client.test.ts       # Connection, timeout, fallback
├── watcher.test.ts      # fs.watch invalidation, debounce
└── lifecycle.test.ts    # Idle timeout, PID file, shutdown
```

Integration test: Start daemon, send RPC, verify response matches direct CLI output.

## 9. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| fs.watch unreliable on some OS/FS | Medium | Stale cache | Periodic full re-read (every 60s). Client can send `--no-cache` flag. |
| Daemon crash leaves stale socket | Low | Connection refused | Client checks PID liveness before connecting. Stale socket auto-cleaned. |
| Multiple projects need multiple daemons | Low | Memory | Each daemon is ~20MB RSS. Idle timeout reclaims. Max 5 concurrent (configurable). |
| Container state drift (config change) | Medium | Wrong behavior | Config file change triggers daemon restart via watcher. |
| Windows compatibility | High | No Unix sockets | Use named pipes (`\\.\pipe\orchestry-<hash>`) — same `net` module API. |

## 10. Decision Log

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Unix domain socket over TCP | No port conflicts, faster, per-project scoped | TCP: port management complexity. HTTP: unnecessary overhead. |
| JSON-RPC 2.0 over custom protocol | Standard, tooling support, batch-capable | MessagePack: faster but harder to debug. gRPC: overkill for this scale. |
| NDJSON framing over length-prefix | Simple, debuggable (`echo | socat`) | Length-prefix: more robust for binary, but we only send JSON. |
| Lazy re-read over eager push | Simpler, fewer edge cases | Push: lower latency but complex cache coherence. |
| Node.js client first over native | Zero new tooling, still provides 15ms savings | Rust: optimal but adds build complexity before demand is proven. |
| Per-project daemon over global | Isolation, different configs per project | Global: one process, but routing/multi-project complexity. |
| Auto-start on first CLI call | Zero user action required | Manual start: simpler but worse DX. systemd service: platform-specific. |

## 11. File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/daemon/protocol.ts` | JSON-RPC 2.0 types, encode/decode |
| `src/daemon/server.ts` | Unix socket server, connection handling |
| `src/daemon/router.ts` | Method → service dispatch |
| `src/daemon/client.ts` | Thin IPC client for CLI |
| `src/daemon/watcher.ts` | fs.watch cache invalidation |
| `src/daemon/lifecycle.ts` | Idle timeout, PID file, health |
| `src/cli/commands/daemon.ts` | `orch daemon start/stop/status/restart` |
| `test/unit/daemon/*.test.ts` | Unit tests (6 files) |

### Modified Files

| File | Change |
|------|--------|
| `src/bin/cli.ts` | Add daemon client short-circuit before container build |
| `src/domain/config.ts` | Add `DaemonConfig` to `OrchestratorConfig` |
| `src/container.ts` | Export individual store constructors for daemon router |
| `.orchestry/.gitignore` | Add `daemon.sock`, `daemon.pid` |

### Estimated Size

- ~400 LOC new TypeScript
- ~300 LOC tests
- 0 new npm dependencies (uses `node:net`, `node:fs`, `node:child_process`)

## 12. Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| `orch task list` (warm daemon) | 55ms | <10ms | `scripts/benchmark.ts` |
| `orch msg inbox <id>` (warm daemon) | 43ms | <8ms | `scripts/benchmark.ts` |
| Daemon memory (idle) | N/A | <30MB RSS | `orch daemon status` |
| Daemon startup time | N/A | <500ms | Time from spawn to socket ready |
| Fallback reliability | N/A | 100% | If daemon fails, CLI works as before |
