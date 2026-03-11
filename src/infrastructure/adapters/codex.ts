/**
 * Codex CLI adapter.
 *
 * Spawns `codex exec --json -` in headless mode.
 * Prompt is piped via stdin (avoids CLI arg length limits).
 * Parses JSONL events from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { readLines } from '../process/process-manager.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class CodexAdapter implements IAgentAdapter {
  readonly kind = 'codex';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execFileAsync('codex', ['--version']);
      return { ok: true, version: stdout.trim() };
    } catch {
      return {
        ok: false,
        error: 'Codex CLI not found. Install: npm i -g @openai/codex',
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      'exec',
      '--json',
      '--sandbox', 'danger-full-access', // autonomous agents can't respond to approval prompts
    ];

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    // Read prompt from stdin (avoids ARG_MAX limits on long prompts)
    args.push('-');

    const { process: proc, pid } = this.processManager.spawn('codex', args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
      stdio: ['pipe', 'pipe', 'pipe'], // stdin must be 'pipe' to send prompt
    });

    // Pipe prompt via stdin
    if (proc.stdin) {
      proc.stdin.write(params.prompt);
      proc.stdin.end();
    }

    const signal = params.signal;

    async function* generateEvents(): AsyncGenerator<AgentEvent> {
      let gotDoneEvent = false;

      let exitCode: number | null = null;
      let exitError: Error | null = null;
      const exitPromise = new Promise<void>((resolve) => {
        proc.on('close', (code) => { exitCode = code; resolve(); });
        proc.on('error', (err) => { exitError = err; resolve(); });
      });

      if (proc.stdout) {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          const event = parseCodexEvent(line);
          if (event) {
            if (event.type === 'done') gotDoneEvent = true;
            yield event;
          }
        }
      }

      await exitPromise;

      if (exitError && !signal?.aborted && !gotDoneEvent) {
        throw exitError;
      }
      if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
        throw new Error(`Codex process exited with code ${exitCode}`);
      }
    }

    return { pid, events: generateEvents() };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function extractTokens(parsed: any): { input: number; output: number; total: number } | undefined {
  const usage = parsed.usage;
  if (usage && typeof usage.input_tokens === 'number') {
    const input = usage.input_tokens;
    const output = usage.output_tokens ?? 0;
    return { input, output, total: input + output };
  }
  return undefined;
}

function parseCodexEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed = JSON.parse(line);
    const timestamp = new Date().toISOString();

    const type = parsed.type ?? '';

    // Codex JSONL event types
    switch (type) {
      // Thread/session started
      case 'thread.started':
        return { type: 'output', timestamp, data: parsed };

      // Turn lifecycle
      case 'turn.started':
        return { type: 'output', timestamp, data: parsed };

      case 'turn.completed': {
        const tokens = extractTokens(parsed);
        return { type: 'done', timestamp, data: parsed, tokens };
      }

      case 'turn.failed': {
        const tokens = extractTokens(parsed);
        return { type: 'error', timestamp, data: parsed, tokens };
      }

      // Item events
      case 'item.started':
      case 'item.completed': {
        const item = parsed.item ?? {};
        const itemType = item.type ?? '';

        if (itemType === 'agent_message') {
          return { type: 'output', timestamp, data: item };
        }
        if (itemType === 'reasoning') {
          return { type: 'output', timestamp, data: item };
        }
        if (itemType === 'command_execution') {
          return { type: 'command', timestamp, data: item };
        }
        if (itemType === 'file_change') {
          // Extract individual file paths from Codex's changes array
          const changes = Array.isArray(item.changes) ? item.changes : [];
          const paths = changes
            .map((c: any) => typeof c.path === 'string' ? c.path : '')
            .filter(Boolean);
          return { type: 'file_change', timestamp, data: { paths, raw: item } };
        }
        if (itemType === 'tool_use') {
          return { type: 'tool_call', timestamp, data: item };
        }
        if (itemType === 'tool_result') {
          return { type: 'output', timestamp, data: item };
        }
        if (itemType === 'error') {
          return { type: 'error', timestamp, data: item };
        }
        return { type: 'output', timestamp, data: item };
      }

      case 'error':
        return { type: 'error', timestamp, data: parsed.error ?? parsed };

      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}
