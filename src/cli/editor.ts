/**
 * Shared utility for opening temporary files in $EDITOR.
 *
 * Opens a tmpfile with initial content in the user's preferred editor,
 * waits for it to close, and returns the edited text.
 */

import { writeFile, readFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface OpenInEditorOptions {
  /** File extension for the temp file (default: '.yml') */
  extension?: string;
  /** Prefix for the temp directory name */
  prefix?: string;
}

/**
 * Opens `initialContent` in the user's $EDITOR/$VISUAL/vi,
 * waits for the editor to close, and returns the edited content.
 *
 * Creates a temporary file that is cleaned up after reading.
 */
export async function openInEditor(
  initialContent: string,
  opts: OpenInEditorOptions = {},
): Promise<string> {
  const { extension = '.yml', prefix = 'orch-' } = opts;

  const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'vi';
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(dir, `edit${extension}`);

  await writeFile(filePath, initialContent, 'utf8');

  try {
    const parts = editor.split(/\s+/);
    const child = spawn(parts[0]!, [...parts.slice(1), filePath], { stdio: 'inherit' });

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Editor exited with code ${code}`));
      });
      child.on('error', reject);
    });

    return await readFile(filePath, 'utf8');
  } finally {
    await unlink(filePath).catch(() => {});
    await rm(dir, { recursive: true }).catch(() => {});
  }
}

/**
 * Serialize task fields into YAML frontmatter + description body.
 *
 * Format:
 * ```
 * ---
 * title: My Task
 * priority: 2
 * ---
 * Free-form description here...
 * ```
 */
export function toEditorContent(fields: {
  title: string;
  priority: number;
  description?: string;
}): string {
  const lines = [
    '---',
    `title: ${fields.title}`,
    `priority: ${fields.priority}`,
    '---',
    '',
    fields.description ?? '',
  ];
  return lines.join('\n');
}

/**
 * Parse YAML frontmatter + description body back into fields.
 */
export function fromEditorContent(content: string): {
  title?: string;
  priority?: number;
  description?: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    // No frontmatter — treat entire content as description
    return { description: content.trim() || undefined };
  }

  const frontmatter = match[1] ?? '';
  const body = match[2] ?? '';
  const result: { title?: string; priority?: number; description?: string } = {};

  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^([\w]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2] ?? '';
    if (key === 'title' && value.trim()) {
      result.title = value.trim();
    } else if (key === 'priority') {
      const n = parseInt(value.trim(), 10);
      if (n >= 1 && n <= 4) result.priority = n;
    }
  }

  const desc = body.trim();
  if (desc) result.description = desc;

  return result;
}

// ── Agent editor helpers ──────────────────────────────────────

export interface AgentEditorFields {
  name?: string;
  role?: string;
  model?: string;
}

/**
 * Serialize agent fields into YAML frontmatter + role as body.
 *
 * Format:
 * ```
 * # Edit agent configuration.
 * # Lines starting with # are ignored.
 * # Role description goes below the --- separator.
 * ---
 * name: My Agent
 * model: claude-sonnet-4-6
 * ---
 *
 * Role description here...
 * ```
 */
export function agentToEditorContent(fields: {
  name: string;
  model?: string;
  role?: string;
}): string {
  const lines = [
    '# Edit agent configuration.',
    '# Lines starting with # are ignored.',
    '# Role description goes below the second --- separator.',
    '---',
    `name: ${fields.name}`,
    `model: ${fields.model ?? ''}`,
    '---',
    '',
    fields.role ?? '',
  ];
  return lines.join('\n');
}

/**
 * Parse agent editor content back into fields.
 * Strips comment lines (starting with #) before parsing.
 */
export function agentFromEditorContent(content: string): AgentEditorFields {
  // Strip comment lines only BEFORE the first --- delimiter
  // (preserves # in role body — markdown headings, shell comments, etc.)
  const lines = content.split('\n');
  const firstFence = lines.findIndex((l) => l.trimEnd() === '---');
  const stripped = (firstFence >= 0
    ? [...lines.slice(0, firstFence).filter((l) => !l.startsWith('#')), ...lines.slice(firstFence)]
    : lines.filter((l) => !l.startsWith('#'))
  ).join('\n');

  const match = stripped.trimStart().match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    // No frontmatter — treat entire content as role
    const role = stripped.trim();
    return { role: role || undefined };
  }

  const frontmatter = match[1] ?? '';
  const body = match[2] ?? '';
  const result: AgentEditorFields = {};

  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^([\w]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2] ?? '';
    if (key === 'name') {
      result.name = value.trim();
    } else if (key === 'model') {
      result.model = value.trim();
    }
  }

  // Always set role (empty string = cleared) so callers can detect clearing
  result.role = body.trim();

  return result;
}
