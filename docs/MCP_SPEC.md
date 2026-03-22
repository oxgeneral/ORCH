# MCP Integration Spec for ORCH

> **Status**: 🔜 Draft — Not yet implemented. This is a design proposal.
> **Target**: Post v1.0.8

> **Version**: 0.1.0 (Draft)
> **Date**: 2026-03-14
> **Author**: Backend A (agt_9fuuLGj)

## Overview

This spec defines two complementary MCP integrations for the ORCH ecosystem:

1. **`mcp` adapter** (`src/infrastructure/adapters/mcp.ts`) — enables ORCH to orchestrate MCP-compatible agents (any process that speaks MCP protocol as a server)
2. **`@oxgeneral/orch-mcp` package** — an MCP server that exposes the ORCH Engine API as MCP tools, allowing Claude Code, Cursor, VS Code, and any MCP client to control ORCH programmatically

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Clients (Claude Code, Cursor, VS Code)                 │
│  ┌───────────┐  ┌──────────┐  ┌────────────┐               │
│  │ Claude    │  │ Cursor   │  │ VS Code    │               │
│  │ Code      │  │          │  │ Copilot    │               │
│  └─────┬─────┘  └────┬─────┘  └─────┬──────┘               │
│        │              │              │                      │
│        └──────────────┼──────────────┘                      │
│                       │ MCP Protocol (stdio/SSE)            │
│                       ▼                                     │
│         ┌─────────────────────────────┐                     │
│         │  @oxgeneral/orch-mcp        │ ◄── Package #2      │
│         │  (MCP Server)               │                     │
│         │  Exposes: task/agent/context │                     │
│         │  API as MCP tools           │                     │
│         └─────────────┬───────────────┘                     │
│                       │ imports @oxgeneral/orch             │
│                       ▼                                     │
│         ┌─────────────────────────────┐                     │
│         │  ORCH Engine                │                     │
│         │  (LightContainer)           │                     │
│         │  TaskService, AgentService  │                     │
│         │  ContextStore, MessageStore │                     │
│         └─────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ORCH Orchestrator                                          │
│  ┌──────────────────────┐                                   │
│  │  AdapterRegistry     │                                   │
│  │  ┌──────┐ ┌────────┐ │                                   │
│  │  │claude│ │ codex  │ │                                   │
│  │  ├──────┤ ├────────┤ │                                   │
│  │  │cursor│ │opencode│ │                                   │
│  │  ├──────┤ ├────────┤ │                                   │
│  │  │shell │ │  mcp   │ │ ◄── Adapter #1 (new)             │
│  │  └──────┘ └────┬───┘ │                                   │
│  └────────────────┼─────┘                                   │
│                   │ MCP Client Protocol                     │
│                   ▼                                         │
│  ┌────────────────────────────────┐                         │
│  │  External MCP Agent Server     │                         │
│  │  (any MCP-compatible agent)    │                         │
│  │  e.g. custom coding agent,     │                         │
│  │  research agent, data agent    │                         │
│  └────────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 1: MCP Agent Adapter

### 1.1 Purpose

Allow ORCH to orchestrate any MCP-compatible agent server. The adapter acts as an MCP **client** that connects to an external MCP server process, calls a designated tool (or a `run_task` tool), and streams results back as `AgentEvent`s.

### 1.2 Agent Configuration

```yaml
# .orchestry/agents/researcher.yaml
id: agt_abc1234
name: "Research Agent"
adapter: mcp
config:
  # MCP-specific config
  mcp_command: "npx"                    # Command to spawn MCP server
  mcp_args: ["my-research-agent"]       # Arguments
  mcp_transport: "stdio"                # "stdio" | "sse"
  mcp_url: null                         # For SSE transport: "http://localhost:3001/sse"
  mcp_tool: "run_task"                  # Which MCP tool to call (default: "run_task")
  mcp_env:                              # Extra env vars for MCP server process
    RESEARCH_API_KEY: "${RESEARCH_API_KEY}"

  # Standard ORCH config
  max_turns: 1                          # MCP tools are typically single-turn
  timeout_ms: 300000
  stall_timeout_ms: 60000
```

### 1.3 Interface Implementation

```typescript
// src/infrastructure/adapters/mcp.ts

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';
import { EventBuffer } from './event-buffer.js';

export class McpAdapter implements IAgentAdapter {
  readonly kind = 'mcp';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    // MCP adapter itself is always available — the actual MCP server
    // availability is per-agent (checked at execute time via handshake)
    return { ok: true, version: '1.0.0' };
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const config = params.config;
    const mcpCommand = config.command;  // Reuse existing 'command' field
    const mcpArgs = config.mcp_args ?? [];
    const mcpTransport = config.mcp_transport ?? 'stdio';
    const mcpTool = config.mcp_tool ?? 'run_task';

    if (mcpTransport === 'stdio') {
      return this.executeStdio(params, mcpCommand, mcpArgs, mcpTool);
    } else {
      return this.executeSse(params, config.mcp_url, mcpTool);
    }
  }

  private executeStdio(
    params: ExecuteParams,
    command: string | undefined,
    args: string[],
    toolName: string,
  ): ExecuteHandle {
    if (!command) {
      return this.errorHandle('MCP adapter requires command in agent config');
    }

    // Spawn the MCP server process
    const { process: proc, pid } = this.processManager.spawn(command, args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
    });

    const signal = params.signal;
    const buffer = new EventBuffer();

    // MCP stdio protocol: JSON-RPC 2.0 over stdin/stdout
    const mcpSession = this.createStdioSession(proc, buffer, toolName, params, signal);
    void mcpSession; // fire-and-forget, buffer handles backpressure

    return { pid, events: this.drainBuffer(buffer, signal) };
  }

  // ... (implementation details in §1.5)
}
```

### 1.4 MCP Protocol Flow (stdio)

```
ORCH McpAdapter                    External MCP Server
     │                                    │
     │──── initialize ───────────────────►│
     │◄─── initialize response ──────────│
     │                                    │
     │──── tools/list ───────────────────►│  (optional: validate tool exists)
     │◄─── tools/list response ──────────│
     │                                    │
     │──── tools/call ───────────────────►│  { tool: "run_task", arguments: { prompt, context } }
     │◄─── tools/call response ──────────│  { content: [{ type: "text", text: "..." }] }
     │                                    │
     │──── (close connection) ───────────►│
     │                                    │
```

### 1.5 Key Design Decisions

1. **Reuse `config.command`** — the existing `command` field in `AgentConfig` is reused to specify the MCP server command. This avoids domain model changes. MCP-specific fields (`mcp_args`, `mcp_transport`, `mcp_url`, `mcp_tool`) are added to `AgentConfig`.

2. **Single-turn by default** — MCP tools are typically request-response. The adapter calls `tools/call` once and maps the response to `AgentEvent`s. For multi-step agents, the MCP server itself manages the loop.

3. **Graceful degradation** — if the MCP server doesn't have the specified tool, the adapter yields an `error` event with `errorKind: SPAWN_FAILED`.

4. **Token extraction** — MCP responses include optional `_meta` field. Tokens are extracted from `_meta.tokens` if present.

### 1.6 AgentConfig Extension

```typescript
// Addition to src/domain/agent.ts AgentConfig interface

export interface AgentConfig {
  // ... existing fields ...

  // MCP-specific (only used when adapter === 'mcp')
  mcp_args?: string[];
  mcp_transport?: 'stdio' | 'sse';
  mcp_url?: string;
  mcp_tool?: string;
}
```

### 1.7 Registration

```typescript
// In src/container.ts buildFullContainer():

import { McpAdapter } from './infrastructure/adapters/mcp.js';

// ... in adapter registration block:
adapterRegistry.register(new McpAdapter(processManager));
```

---

## Part 2: @oxgeneral/orch-mcp Package

### 2.1 Purpose

An MCP server package that exposes the ORCH Engine API as MCP tools. When installed and configured in Claude Code, Cursor, or VS Code, it allows AI assistants to:

- Create and manage tasks
- List and query agents
- Read/write shared context
- Send messages between agents
- Track goals
- Monitor orchestrator status

### 2.2 Package Structure

```
packages/orch-mcp/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── src/
│   ├── index.ts          # Entry point (MCP server setup)
│   ├── server.ts         # McpServer class with tool registration
│   ├── tools/
│   │   ├── task-tools.ts     # task_list, task_add, task_update, task_get
│   │   ├── agent-tools.ts    # agent_list, agent_get, agent_add
│   │   ├── context-tools.ts  # context_set, context_get, context_list
│   │   ├── message-tools.ts  # msg_send, msg_broadcast, msg_inbox
│   │   ├── goal-tools.ts     # goal_list, goal_get, goal_progress
│   │   └── status-tools.ts   # status_get, logs_tail
│   ├── resources/
│   │   ├── task-resource.ts   # task://{id} resource
│   │   └── agent-resource.ts  # agent://{id} resource
│   └── util/
│       └── container.ts       # Builds LightContainer from cwd
└── test/
    ├── server.test.ts
    └── tools/
        ├── task-tools.test.ts
        └── context-tools.test.ts
```

### 2.3 Package Configuration

```json
{
  "name": "@oxgeneral/orch-mcp",
  "version": "0.1.0",
  "description": "MCP server for ORCH — expose task/agent API to Claude Code, Cursor, VS Code",
  "type": "module",
  "bin": {
    "orch-mcp": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@oxgeneral/orch": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.25.0"
  },
  "peerDependencies": {
    "@oxgeneral/orch": ">=1.0.0"
  }
}
```

### 2.4 MCP Server Implementation

```typescript
// packages/orch-mcp/src/server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildLightContainer } from '@oxgeneral/orch';
import type { LightContainer } from '@oxgeneral/orch';

export async function createOrchMcpServer(projectRoot: string): Promise<McpServer> {
  const container = await buildLightContainer({
    projectRoot,
    command: 'mcp-server',
  });

  const server = new McpServer({
    name: 'orch',
    version: '0.1.0',
  });

  // Register all tool groups (uses server.registerTool API)
  registerTaskTools(server, container);
  registerAgentTools(server, container);
  registerContextTools(server, container);
  registerMessageTools(server, container);
  registerGoalTools(server, container);
  registerStatusTools(server, container);

  // Register resources (uses server.registerResource API)
  registerTaskResources(server, container);
  registerAgentResources(server, container);

  return server;
}
```

### 2.5 Tool Definitions

#### 2.5.1 Task Tools

| Tool | Description | Input Schema | Output |
|------|-------------|-------------|--------|
| `orch_task_list` | List tasks with optional status filter | `{ status?: TaskStatus, assignee?: string, limit?: number }` | JSON array of tasks |
| `orch_task_add` | Create a new task | `{ title: string, description?: string, priority?: 1\|2\|3\|4, assignee?: string, depends_on?: string[], scope?: string[], labels?: string[] }` | Created task JSON |
| `orch_task_get` | Get task by ID | `{ id: string }` | Task JSON |
| `orch_task_update` | Update task status/fields | `{ id: string, status?: TaskStatus, assignee?: string, feedback?: string }` | Updated task JSON |

```typescript
// packages/orch-mcp/src/tools/task-tools.ts

export function registerTaskTools(server: McpServer, container: LightContainer) {
  server.registerTool(
    'orch_task_list',
    {
      description: 'List tasks in the ORCH orchestrator. Filter by status, assignee, or priority.',
      inputSchema: z.object({
        status: z.enum(['todo', 'in_progress', 'retrying', 'review', 'done', 'failed', 'cancelled']).optional(),
        assignee: z.string().optional().describe('Agent ID to filter by'),
        limit: z.number().int().min(1).max(100).optional().default(50),
      }),
    },
    async ({ status, assignee, limit }) => {
      let tasks = await container.taskService.list();

      if (status) tasks = tasks.filter(t => t.status === status);
      if (assignee) tasks = tasks.filter(t => t.assignee === assignee);
      tasks = tasks.slice(0, limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(tasks, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'orch_task_add',
    {
      description: 'Create a new task in the ORCH orchestrator.',
      inputSchema: z.object({
        title: z.string().min(1).describe('Task title'),
        description: z.string().optional().describe('Detailed description'),
        priority: z.number().int().min(1).max(4).optional().default(3),
        assignee: z.string().optional().describe('Agent ID to assign to'),
        depends_on: z.array(z.string()).optional().describe('Task IDs this depends on'),
        scope: z.array(z.string()).optional().describe('File globs this task touches'),
        labels: z.array(z.string()).optional(),
      }),
    },
    async (input) => {
      const task = await container.taskService.create(input);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(task, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'orch_task_get',
    {
      description: 'Get a specific task by ID.',
      inputSchema: z.object({
        id: z.string().describe('Task ID (tsk_xxx)'),
      }),
    },
    async ({ id }) => {
      const task = await container.taskService.get(id);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(task, null, 2),
        }],
      };
    },
  );
}
```

#### 2.5.2 Agent Tools

| Tool | Description | Input Schema |
|------|-------------|-------------|
| `orch_agent_list` | List all agents with status | `{ status?: AgentStatus }` |
| `orch_agent_get` | Get agent by ID | `{ id: string }` |
| `orch_agent_add` | Create a new agent | `{ name, adapter, role?, model?, ... }` |

#### 2.5.3 Context Tools

| Tool | Description | Input Schema |
|------|-------------|-------------|
| `orch_context_set` | Set shared context key-value | `{ key: string, value: string }` |
| `orch_context_get` | Get context value by key | `{ key: string }` |
| `orch_context_list` | List all context keys | `{}` |

#### 2.5.4 Message Tools

| Tool | Description | Input Schema |
|------|-------------|-------------|
| `orch_msg_send` | Send direct message to agent | `{ to: string, body: string, subject?: string }` |
| `orch_msg_broadcast` | Broadcast to all agents | `{ body: string, subject?: string }` |
| `orch_msg_inbox` | Read inbox for agent | `{ agent_id: string }` |

#### 2.5.5 Goal Tools

| Tool | Description | Input Schema |
|------|-------------|-------------|
| `orch_goal_list` | List all goals | `{}` |
| `orch_goal_get` | Get goal by ID | `{ id: string }` |

#### 2.5.6 Status Tools

| Tool | Description | Input Schema |
|------|-------------|-------------|
| `orch_status` | Get orchestrator status (running agents, task counts) | `{}` |

### 2.6 MCP Resources

Resources provide read-only access to ORCH data via URI templates:

```typescript
// Task resource (dynamic, URI template)
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

server.registerResource(
  'task',
  new ResourceTemplate('task://{id}', {
    list: async () => {
      const tasks = await container.taskService.list();
      return {
        resources: tasks.map(t => ({ uri: `task://${t.id}`, name: t.title })),
      };
    },
  }),
  { title: 'ORCH Task', mimeType: 'application/json' },
  async (uri, { id }) => {
    const task = await container.taskService.get(id as string);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(task, null, 2),
      }],
    };
  },
);
```

### 2.7 Client Configuration

#### Claude Code (`~/.claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "orch": {
      "command": "npx",
      "args": ["@oxgeneral/orch-mcp"],
      "env": {
        "ORCH_PROJECT_ROOT": "/path/to/project"
      }
    }
  }
}
```

#### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "orch": {
      "command": "npx",
      "args": ["@oxgeneral/orch-mcp"],
      "env": {
        "ORCH_PROJECT_ROOT": "."
      }
    }
  }
}
```

#### VS Code (`.vscode/settings.json`)

```json
{
  "mcp.servers": {
    "orch": {
      "command": "npx",
      "args": ["@oxgeneral/orch-mcp"]
    }
  }
}
```

### 2.8 Entry Point

```typescript
// packages/orch-mcp/src/index.ts
#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOrchMcpServer } from './server.js';

const projectRoot = process.env.ORCH_PROJECT_ROOT || process.cwd();

const server = await createOrchMcpServer(projectRoot);
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Part 3: Implementation Plan

### Phase 1: @oxgeneral/orch-mcp package (P2, ~3 days)

This is higher priority because it provides **immediate value** — any Claude Code/Cursor user can control ORCH from their AI assistant.

| Step | Task | Files | Effort |
|------|------|-------|--------|
| 1 | Scaffold package structure | `packages/orch-mcp/` | 0.5d |
| 2 | Implement core server + task tools | `server.ts`, `tools/task-tools.ts` | 1d |
| 3 | Implement remaining tools | `tools/*.ts` | 0.5d |
| 4 | Add resources + prompts | `resources/*.ts` | 0.5d |
| 5 | Tests | `test/**` | 0.5d |

**Dependencies**: `@modelcontextprotocol/sdk` (npm), `zod` (for schema validation, bundled with MCP SDK).

**Build**: tsup, same config pattern as main package.

### Phase 2: MCP Agent Adapter (P3, ~2 days)

| Step | Task | Files | Effort |
|------|------|-------|--------|
| 1 | Extend AgentConfig with MCP fields | `src/domain/agent.ts` | 0.25d |
| 2 | Implement McpAdapter | `src/infrastructure/adapters/mcp.ts` | 1d |
| 3 | Register in container | `src/container.ts` | 0.1d |
| 4 | Tests | `test/unit/infrastructure/adapters/mcp.test.ts` | 0.5d |
| 5 | Docs + CLI help | `docs/`, CLI adapter list | 0.25d |

**Dependencies**: `@modelcontextprotocol/sdk` (added as optional peer dependency to main package).

### Phase 3: Integration Testing (P3, ~1 day)

- End-to-end test: spawn orch-mcp server → call tools via MCP client
- Test: MCP adapter → spawn test MCP server → orchestrate

---

## Part 4: Design Decisions & Trade-offs

### 4.1 Why LightContainer for orch-mcp?

The MCP server only needs read/write access to ORCH stores and services. It does NOT need:
- ProcessManager (doesn't spawn agents)
- AdapterRegistry (doesn't execute tasks)
- Orchestrator (doesn't run tick loop)
- LiquidJS template engine

Using `LightContainer` keeps the MCP server lightweight (<50ms startup) and avoids loading unnecessary dependencies.

### 4.2 Why separate package vs built-in?

| Option | Pros | Cons |
|--------|------|------|
| **Separate `@oxgeneral/orch-mcp`** | Clean dependency tree; users who don't need MCP don't pay for it; independent versioning | Extra package to maintain |
| Built into `@oxgeneral/orch` | Single install | Adds `@modelcontextprotocol/sdk` + `zod` to all users |

**Decision**: Separate package. MCP SDK + zod add ~2MB. Users who want MCP install `@oxgeneral/orch-mcp` explicitly.

### 4.3 MCP Adapter: Why not use existing adapters?

MCP agents speak a fundamentally different protocol (JSON-RPC 2.0) compared to existing adapters that parse stdout JSON-lines. The MCP adapter needs to:
- Perform JSON-RPC handshake (initialize)
- Call specific tools by name
- Handle MCP-specific error codes
- Parse MCP content blocks (text, image, resource)

This justifies a separate adapter rather than extending shell/claude.

### 4.4 Naming: `orch_` prefix for tools

MCP tools share a global namespace per server. Using `orch_` prefix:
- Avoids collision with other MCP servers
- Makes tool purpose clear in multi-server setups
- Follows convention: `@orchestrator-cli/mcp-server` uses `orchestrator_` prefix

### 4.5 Security Considerations

1. **No secrets in MCP responses** — tool outputs must not leak env vars or API keys
2. **Input validation** — all tool inputs validated via zod schemas before passing to services
3. **Read-only mode** — optional `ORCH_MCP_READONLY=true` env var to disable write tools
4. **Path traversal** — `ORCH_PROJECT_ROOT` must be validated (no `..` resolution outside allowed dirs)

---

## Part 5: User Stories

### 5.1 Developer using Claude Code with ORCH

```
Developer: "Add a task to fix the login bug, priority 1, assign to Backend A"

Claude Code → calls orch_task_add {
  title: "Fix login bug",
  priority: 1,
  assignee: "agt_9fuuLGj"
}

Claude Code ← receives created task JSON

Developer: "What's the status of all in-progress tasks?"

Claude Code → calls orch_task_list { status: "in_progress" }
Claude Code ← receives list of active tasks
```

### 5.2 AI Agent running as MCP server

```yaml
# .orchestry/agents/data-analyst.yaml
name: "Data Analyst"
adapter: mcp
config:
  command: "npx"
  mcp_args: ["@company/data-analysis-agent"]
  mcp_tool: "analyze_data"
  timeout_ms: 600000
```

ORCH spawns the MCP server, calls `analyze_data` with the task prompt, and collects results.

---

## Part 6: Open Questions

1. **Monorepo vs separate repo?** — Should `packages/orch-mcp/` live in the ORCH monorepo or a separate `orch-mcp` repo? Recommendation: monorepo with npm workspaces, publish independently.

2. **SSE transport** — Should orch-mcp support SSE in addition to stdio? Useful for remote ORCH instances. Phase 2 feature.

3. **Streaming** — MCP tools/call returns a single response. For long-running ORCH tasks, should we use MCP notifications/progress? The MCP spec supports `notifications/progress` — consider for Phase 2.

4. **Authentication** — For SSE transport, what auth mechanism? Bearer token? Phase 2.

5. **MCP adapter: multi-tool agents** — Should the MCP adapter support calling multiple tools in sequence (agentic loop)? Or is single-tool sufficient? Single-tool for Phase 1, agentic loop for Phase 2.

---

## Appendix A: Comparison with Existing Adapters

| Feature | Claude | Codex | Shell | MCP (new) |
|---------|--------|-------|-------|-----------|
| Protocol | JSON-lines stdout | JSON-lines stdout | plain stdout | JSON-RPC 2.0 |
| Spawns process | ✅ | ✅ | ✅ | ✅ (MCP server) |
| Multi-turn | ✅ (max_turns) | ✅ | ❌ | ❌ (Phase 1) |
| Token tracking | ✅ | ✅ | ❌ | ✅ (via _meta) |
| Abort support | ✅ (SIGTERM) | ✅ | ✅ | ✅ (close transport) |
| System prompt | ✅ (--system-prompt) | ✅ (--system-prompt) | ❌ (env var) | ❌ (in tool args) |

## Appendix B: MCP SDK Quick Reference

```typescript
// Server creation
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'orch', version: '0.1.0' });

// Tool registration (zod schemas, v1.x API)
server.registerTool('name', {
  description: 'Tool description',
  inputSchema: z.object({ param: z.string() }),
}, async (args) => {
  return { content: [{ type: 'text', text: 'result' }] };
});

// Resource registration (static)
server.registerResource('name', 'status://server', {
  title: 'Status', mimeType: 'application/json',
}, async (uri) => {
  return { contents: [{ uri: uri.href, text: '...' }] };
});

// Resource registration (dynamic, URI template)
server.registerResource('items', new ResourceTemplate('item://{id}', {
  list: async () => ({ resources: [{ uri: 'item://1', name: 'Item 1' }] }),
}), { title: 'Item' }, async (uri, { id }) => {
  return { contents: [{ uri: uri.href, text: `Item ${id}` }] };
});

// Prompt registration
server.registerPrompt('summarize', {
  title: 'Summarize',
  argsSchema: z.object({ text: z.string() }),
}, ({ text }) => ({
  messages: [{ role: 'user', content: { type: 'text', text: `Summarize: ${text}` } }],
}));

// Start server (stdio transport)
const transport = new StdioServerTransport();
await server.connect(transport);
// IMPORTANT: use console.error() for logging — console.log() corrupts stdio JSON-RPC
```

## Appendix C: Existing Adapter Pattern Summary

All ORCH adapters implement `IAgentAdapter`:
```typescript
interface IAgentAdapter {
  readonly kind: string;              // Adapter identifier
  test(): Promise<AdapterTestResult>; // Health check
  execute(params: ExecuteParams): ExecuteHandle;  // Spawn + stream
  stop(pid: number): Promise<void>;   // Graceful shutdown
}
```

`ExecuteHandle` = `{ pid: number; events: AsyncGenerator<AgentEvent> }`

`AgentEvent.type` = `'output' | 'file_change' | 'command' | 'tool_call' | 'error' | 'done'`

Pattern: adapter spawns child process via `IProcessManager.spawn()`, parses stdout into `AgentEvent` stream, yields via `AsyncGenerator`. All adapters use `EventBuffer` or `createStreamingEvents()` utility for backpressure-safe streaming.
