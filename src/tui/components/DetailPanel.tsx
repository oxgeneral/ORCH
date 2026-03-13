/**
 * TUI DetailPanel — shows task details in the bottom panel.
 *
 * Replaces ACTIVITY feed when a task is selected via Enter.
 * Layout:
 *   DETAIL ── {task title} ──────────────────
 *     status   in_progress       assignee  backend
 *     priority P1                attempts  1/3
 *     labels   auth, security    depends   —
 *
 *     Description text...
 *
 *     ─── result ─────────────────────────────
 *     Agent summary text...
 *
 *     ─── activity ───────────────────────────
 *     16:20:03  ⚙ Read()  ← ✓ 80 lines
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Task } from '../../domain/task.js';
import { tuiColors, TASK_STATUS_COLOR } from '../colors.js';

/** Message types for icon/color mapping */
type MsgType = 'system' | 'lifecycle' | 'output' | 'tool' | 'result' | 'error' | 'file' | 'info';

const MSG_ICONS: Record<MsgType, string> = {
  system: '\u2666',    // ◆
  lifecycle: '\u25B6',  // ▶
  output: '\u2502',     // │
  tool: '\u2699',       // ⚙
  result: '\u2190',     // ←
  error: '\u2715',      // ✕
  file: '\u270E',       // ✎
  info: '\u2502',       // │
};

export interface TaskLog {
  text: string;
  color: string;
  time: string;
  agentId?: string;
  msgType?: string;
}

export interface DetailPanelProps {
  task: Task;
  height: number;
  width: number;
  taskLogs?: TaskLog[];
  /** Map agent ID → agent name for display */
  agentNameMap?: Map<string, string>;
}

/** Render a centered section divider: ─── label ───────────── */
export function SectionDivider({ label, width, color }: { label: string; width: number; color?: string }) {
  const innerW = width - 4; // paddingX=2 on parent
  const labelWithSpaces = ` ${label} `;
  const leftLen = 3;
  const rightLen = Math.max(0, innerW - leftLen - labelWithSpaces.length);
  return (
    <Text color={color ?? tuiColors.ghost}>
      {'  '}{'─'.repeat(leftLen)}{labelWithSpaces}{'─'.repeat(rightLen)}
    </Text>
  );
}

export function DetailPanel({ task, height, width, taskLogs, agentNameMap }: DetailPanelProps) {
  const statusColor = TASK_STATUS_COLOR[task.status] ?? tuiColors.dim;
  const priColor = task.priority <= 2 ? (task.priority === 1 ? tuiColors.red : tuiColors.yellow) : undefined;
  const col1Width = 24;

  const hasDescription = !!task.description?.trim();
  const hasSummary = !!task.proof?.agent_summary;
  const hasFiles = (task.proof?.files_changed?.length ?? 0) > 0;
  const hasLogs = (taskLogs?.length ?? 0) > 0;
  const hasAttachments = (task.attachments?.length ?? 0) > 0;

  // Count fixed rows: 3 meta + description/summary sections
  const descLines = hasDescription ? task.description.split('\n') : [];
  const summaryLines = hasSummary ? task.proof!.agent_summary!.split('\n') : [];

  // Fixed meta rows: 3 key-value rows + optional attachments section
  let usedRows = 3;

  if (hasAttachments) {
    usedRows += 2 + task.attachments!.length; // blank + divider + file lines
  }

  // Description section (blank + lines) or "No description" if no summary either
  if (hasDescription) {
    usedRows += 1; // blank separator
    usedRows += Math.min(descLines.length, Math.max(1, Math.ceil((height - 10) * 0.3)));
  } else if (!hasSummary) {
    usedRows += 2; // blank + "No description."
  }

  // Result section (blank + divider + lines)
  if (hasSummary) {
    usedRows += 2; // blank + divider
  }

  // Files row
  if (hasFiles) {
    usedRows += 1;
  }

  // Activity section (blank + divider)
  if (hasLogs) {
    usedRows += 2; // blank + divider
  }

  // Distribute remaining space between summary and logs
  const remainingRows = Math.max(0, height - usedRows);
  let summaryMaxLines = 0;
  let logMaxLines = 0;

  if (hasSummary && hasLogs) {
    // Split remaining: 40% summary, 60% logs
    summaryMaxLines = Math.max(1, Math.floor(remainingRows * 0.4));
    logMaxLines = Math.max(1, remainingRows - summaryMaxLines);
  } else if (hasSummary) {
    summaryMaxLines = remainingRows;
  } else if (hasLogs) {
    logMaxLines = remainingRows;
  }

  const visibleDescLines = hasDescription
    ? descLines.slice(0, Math.max(1, Math.ceil((height - 10) * 0.3)))
    : [];
  const visibleSummaryLines = summaryLines.slice(0, summaryMaxLines);

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* Row 1: status + assignee */}
      <Box>
        <Box width={col1Width}>
          <Text color={tuiColors.dim}>  status   </Text>
          <Text color={statusColor}>{task.status}</Text>
        </Box>
        <Box>
          <Text color={tuiColors.dim}>  assignee  </Text>
          <Text color={task.assignee ? tuiColors.green : tuiColors.dim}>
            {task.assignee ? (agentNameMap?.get(task.assignee) ?? task.assignee) : '\u2014'}
          </Text>
        </Box>
      </Box>

      {/* Row 2: priority + attempts */}
      <Box>
        <Box width={col1Width}>
          <Text color={tuiColors.dim}>  priority  </Text>
          <Text color={priColor} bold={task.priority <= 2}>P{task.priority}</Text>
        </Box>
        <Box>
          <Text color={tuiColors.dim}>  attempts  </Text>
          <Text>{task.attempts}/{task.max_attempts}</Text>
        </Box>
      </Box>

      {/* Row 3: labels + depends */}
      <Box>
        <Box width={col1Width}>
          <Text color={tuiColors.dim}>  labels    </Text>
          <Text color={tuiColors.purple}>
            {task.labels.length > 0 ? task.labels.join(', ') : '\u2014'}
          </Text>
        </Box>
        <Box>
          <Text color={tuiColors.dim}>  depends   </Text>
          <Text dimColor>
            {task.depends_on.length > 0 ? task.depends_on.join(', ') : '\u2014'}
          </Text>
        </Box>
      </Box>

      {/* Attachments */}
      {hasAttachments && (
        <>
          <Text>{' '}</Text>
          <SectionDivider label={`attachments (${task.attachments!.length})`} width={width} color={tuiColors.dim} />
          {task.attachments!.map((name, i) => (
            <Text key={`a${i}`} color={tuiColors.cyan} wrap="truncate">{'    '}{name}</Text>
          ))}
        </>
      )}

      {/* Description */}
      {hasDescription && (
        <>
          <Text>{' '}</Text>
          {visibleDescLines.map((line, i) => (
            <Text key={`d${i}`} color={tuiColors.silver} wrap="truncate">{'  '}{line}</Text>
          ))}
        </>
      )}

      {/* No content at all */}
      {!hasDescription && !hasSummary && (
        <>
          <Text>{' '}</Text>
          <Text color={tuiColors.dim}>  No description.</Text>
        </>
      )}

      {/* Agent result summary */}
      {hasSummary && (
        <>
          <Text>{' '}</Text>
          <SectionDivider label="result" width={width} color={tuiColors.dim} />
          {visibleSummaryLines.map((line, i) => (
            <Text key={`r${i}`} color={tuiColors.white} wrap="truncate">{'  '}{line}</Text>
          ))}
        </>
      )}

      {/* Proof: branch + files */}
      {hasFiles && (
        <Box>
          <Text color={tuiColors.dim}>  files  </Text>
          <Text color={tuiColors.cyan}>{task.proof!.files_changed.length}</Text>
          <Text color={tuiColors.dim}> changed</Text>
          {task.proof!.branch && (
            <>
              <Text color={tuiColors.dim}>  {'\u00B7'}  </Text>
              <Text color={tuiColors.cyan}>{task.proof!.branch}</Text>
            </>
          )}
        </Box>
      )}

      {/* Task activity log */}
      {hasLogs && (
        <>
          <Text>{' '}</Text>
          <SectionDivider label="activity" width={width} color={tuiColors.dim} />
          {taskLogs!.slice(-logMaxLines).map((log, i) => {
            const msgType = (log.msgType ?? 'info') as MsgType;
            const icon = MSG_ICONS[msgType] ?? '\u2502';

            let textColor = log.color;
            if (msgType === 'tool') textColor = tuiColors.cyan;
            else if (msgType === 'file') textColor = tuiColors.purple;
            else if (msgType === 'error') textColor = tuiColors.red;
            else if (msgType === 'lifecycle') textColor = tuiColors.green;
            else if (msgType === 'system') textColor = tuiColors.dim;

            // prefix: indent(2) + time(~5) + space(1) + icon(1) + space(1) = ~10
            const logTextW = Math.max(10, width - 12);
            const logDisplay = log.text.length > logTextW ? log.text.slice(0, logTextW - 1) + '…' : log.text;

            return (
              <Box key={i}>
                <Text color={tuiColors.ghost}>{'  '}{log.time} </Text>
                <Text color={msgType === 'error' ? tuiColors.red : tuiColors.dim}>{icon} </Text>
                <Text color={textColor} bold={msgType === 'lifecycle'}>
                  {logDisplay}
                </Text>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}

