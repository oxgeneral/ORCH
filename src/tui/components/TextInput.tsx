/**
 * TextInput — unified single-line text input display component.
 *
 * Renders text with a block cursor (█) and handles overflow via a sliding
 * viewport window that keeps the cursor visible. Supports prefix, placeholder,
 * ghost completion text, and error border.
 *
 * This is a pure display component — it does NOT handle keyboard input.
 * Pair with useTextInput hook for keyboard logic.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Cursor } from '../text-cursor.js';
import { graphemeSegments, displayWidth, textDisplayWidth } from '../text-cursor.js';
import { tuiColors } from '../colors.js';

const CURSOR_CHAR = '\u2588'; // █

export interface TextInputProps {
  /** Cursor state from useTextInput. */
  cursor: Cursor;
  /** Available width in terminal columns. */
  width: number;
  /** Prefix string (e.g. '> ' or '/ '). */
  prefix?: string;
  /** Color of the prefix. Default: tuiColors.amber. */
  prefixColor?: string;
  /** Placeholder text shown when input is empty. */
  placeholder?: string;
  /** Ghost completion text rendered after cursor. */
  ghost?: string;
  /** Color of ghost text. Default: tuiColors.ghost. */
  ghostColor?: string;
  /** Show cursor block. Default: true. */
  showCursor?: boolean;
  /** Color of cursor block. Default: tuiColors.amber. */
  cursorColor?: string;
  /** Color of input text. Default: tuiColors.white. */
  textColor?: string;
  /** Color of placeholder. Default: tuiColors.ghost. */
  placeholderColor?: string;
  /** Show error border. Default: false. */
  hasError?: boolean;
}

/**
 * Compute a sliding viewport window around the cursor position.
 *
 * Returns the visible portion of `before` and `after` text, ensuring
 * the cursor is always visible within the available width.
 */
function computeViewport(
  beforeSegs: string[],
  afterSegs: string[],
  availWidth: number,
): { visibleBefore: string; visibleAfter: string } {
  // 1) Show as much of `before` as fits (from the right)
  let beforeW = 0;
  let beforeStart = beforeSegs.length;
  while (beforeStart > 0) {
    const seg = beforeSegs[beforeStart - 1]!;
    const w = displayWidth(seg);
    if (beforeW + w > availWidth - 1) break; // -1 for cursor block
    beforeW += w;
    beforeStart--;
  }

  const visibleBefore = beforeSegs.slice(beforeStart).join('');

  // 2) Fill remaining width with `after`
  const remainingW = Math.max(0, availWidth - beforeW - 1); // -1 for cursor
  let afterW = 0;
  let afterEnd = 0;
  while (afterEnd < afterSegs.length) {
    const seg = afterSegs[afterEnd]!;
    const w = displayWidth(seg);
    if (afterW + w > remainingW) break;
    afterW += w;
    afterEnd++;
  }

  const visibleAfter = afterSegs.slice(0, afterEnd).join('');

  return { visibleBefore, visibleAfter };
}

export function TextInput({
  cursor,
  width,
  prefix,
  prefixColor = tuiColors.amber,
  placeholder,
  ghost,
  ghostColor = tuiColors.ghost,
  showCursor = true,
  cursorColor = tuiColors.amber,
  textColor = tuiColors.white,
  placeholderColor = tuiColors.ghost,
  hasError = false,
}: TextInputProps): React.ReactElement {
  const prefixStr = prefix ?? '';
  const prefixW = textDisplayWidth(prefixStr);
  const availWidth = Math.max(4, width - prefixW);

  const isEmpty = cursor.isEmpty;
  const beforeSegs = graphemeSegments(cursor.before);
  const afterSegs = graphemeSegments(cursor.after);

  const { visibleBefore, visibleAfter } = computeViewport(beforeSegs, afterSegs, availWidth);

  const cursorBlock = showCursor ? CURSOR_CHAR : '';

  const content = isEmpty ? (
    // Empty: show placeholder + cursor
    <Box>
      {prefixStr && <Text color={prefixColor}>{prefixStr}</Text>}
      {placeholder ? (
        <>
          <Text color={placeholderColor}>{placeholder}</Text>
          {showCursor && <Text color={cursorColor}>{cursorBlock}</Text>}
        </>
      ) : (
        showCursor && <Text color={cursorColor}>{cursorBlock}</Text>
      )}
    </Box>
  ) : (
    // Non-empty: before + cursor + after + ghost
    <Box>
      {prefixStr && <Text color={prefixColor}>{prefixStr}</Text>}
      <Text color={textColor}>{visibleBefore}</Text>
      {showCursor && <Text color={cursorColor}>{cursorBlock}</Text>}
      <Text color={textColor}>{visibleAfter}</Text>
      {ghost && <Text color={ghostColor}>{ghost}</Text>}
    </Box>
  );

  if (hasError) {
    return (
      <Box borderStyle="round" borderColor={tuiColors.red}>
        {content}
      </Box>
    );
  }

  return content;
}
