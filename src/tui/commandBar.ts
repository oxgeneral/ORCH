/**
 * Command bar logic — registry, tab-completion, history.
 *
 * Pure TypeScript, no React/Ink. Fully testable in isolation.
 */

/* ── Command Registry ─────────────────────────────────── */

export interface CommandSpec {
  /** Available subcommands (e.g. ['add', 'list', 'show']) */
  sub?: string[];
  /** Argument placeholder for help text */
  args?: string;
  /** One-line description for /help */
  help: string;
}

export const COMMAND_REGISTRY: Record<string, CommandSpec> = {
  task:      { sub: ['add', 'list', 'show', 'cancel', 'retry', 'assign', 'approve', 'reject', 'delete'], help: 'Manage tasks' },
  agent:     { sub: ['add', 'list', 'disable', 'enable', 'delete'], help: 'Manage agents' },
  run:       { args: '[id]', help: 'Run task (or selected)' },
  'run-all': { help: 'Run all todo tasks' },
  watch:     { help: 'Start watch mode (auto-dispatch)' },
  pause:     { help: 'Pause watch mode' },
  status:    { help: 'Show orchestrator status' },
  help:      { help: 'List all commands' },
  quit:      { help: 'Exit the TUI' },
};

/* ── Tab Completion ───────────────────────────────────── */

/**
 * Returns the ghost-text SUFFIX to display after the cursor.
 * E.g. input="/ta" → "sk", input="/task c" → "ancel"
 * Returns null if no completion available.
 */
export function resolveCompletion(input: string): string | null {
  if (!input.startsWith('/')) return null;
  const body = input.slice(1);
  const spaceIdx = body.indexOf(' ');

  if (spaceIdx === -1) {
    // Completing the verb: "/ta" → "sk"
    const prefix = body;
    if (!prefix) return null;
    const match = Object.keys(COMMAND_REGISTRY).find(
      (k) => k.startsWith(prefix) && k !== prefix,
    );
    return match ? match.slice(prefix.length) : null;
  }

  // Completing a subcommand: "/task c" → "ancel"
  const verb = body.slice(0, spaceIdx);
  const spec = COMMAND_REGISTRY[verb];
  if (!spec?.sub) return null;
  const subPrefix = body.slice(spaceIdx + 1);
  if (!subPrefix) return null;
  const match = spec.sub.find(
    (s) => s.startsWith(subPrefix) && s !== subPrefix,
  );
  return match ? match.slice(subPrefix.length) : null;
}

/* ── Suggestions ─────────────────────────────────────── */

export interface Suggestion {
  /** Full command text, e.g. "/task add" */
  cmd: string;
  /** Description to display */
  desc: string;
  /** Subcommands hint, e.g. "add · list · show" */
  subs?: string;
}

/**
 * Returns filtered list of suggestions for the current input.
 * Empty input "/" → all commands. "/ta" → matching commands + their subs.
 */
export function resolveSuggestions(input: string): Suggestion[] {
  if (!input.startsWith('/')) return [];
  const body = input.slice(1);
  const spaceIdx = body.indexOf(' ');

  if (spaceIdx === -1) {
    // Filter top-level commands by prefix
    const prefix = body.toLowerCase();
    const results: Suggestion[] = [];
    for (const [verb, spec] of Object.entries(COMMAND_REGISTRY)) {
      if (!prefix || verb.startsWith(prefix)) {
        const argsHint = spec.args ? ` ${spec.args}` : '';
        results.push({
          cmd: `/${verb}${argsHint}`,
          desc: spec.help,
          subs: spec.sub?.join(' · '),
        });
        // If exact match or strong prefix, also show subcommands
        if (prefix && verb === prefix && spec.sub) {
          for (const sub of spec.sub) {
            results.push({ cmd: `/${verb} ${sub}`, desc: `${spec.help}: ${sub}` });
          }
        }
      }
    }
    return results;
  }

  // Inside a command — show subcommands
  const verb = body.slice(0, spaceIdx);
  const spec = COMMAND_REGISTRY[verb];
  if (!spec?.sub) return [];
  const subPrefix = body.slice(spaceIdx + 1).toLowerCase();
  const results: Suggestion[] = [];
  for (const sub of spec.sub) {
    if (!subPrefix || sub.startsWith(subPrefix)) {
      results.push({ cmd: `/${verb} ${sub}`, desc: `${spec.help}: ${sub}` });
    }
  }
  return results;
}

/* ── Command History ──────────────────────────────────── */

export class CommandHistory {
  private entries: string[] = [];
  private cursor = 0;

  push(cmd: string): void {
    if (!cmd) return;
    // Deduplicate consecutive
    if (this.entries[this.entries.length - 1] !== cmd) {
      this.entries.push(cmd);
      if (this.entries.length > 100) this.entries.shift();
    }
    this.cursor = this.entries.length;
  }

  prev(): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor > 0) this.cursor--;
    return this.entries[this.cursor] ?? null;
  }

  next(): string | null {
    if (this.cursor < this.entries.length - 1) {
      this.cursor++;
      return this.entries[this.cursor] ?? null;
    }
    this.cursor = this.entries.length;
    return null; // past end — clear the input
  }

  reset(): void {
    this.cursor = this.entries.length;
  }
}
