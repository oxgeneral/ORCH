/**
 * useTextInput — unified keyboard logic for text input fields.
 *
 * Returns a `handleInput` callback (NOT a useInput hook) so the parent
 * component decides when to delegate keyboard events. This is critical
 * because FormWizard has a complex useInput dispatcher for text/textarea/select.
 *
 * Features:
 * - Grapheme-aware cursor positioning via Cursor class
 * - Undo stack (Cmd+Z / Ctrl+Z) with debounced snapshots
 * - Kill ring (Ctrl+K/U/W delete, Ctrl+Y yank)
 * - Terminal editing shortcuts (Ctrl+A/E, Option+Left/Right, Cmd+Backspace)
 */

import { useState, useRef, useCallback } from 'react';
import type { Key } from 'ink';
import { Cursor } from '../text-cursor.js';

export interface UseTextInputOptions {
  /** Initial text value. */
  initialValue?: string;
  /** Maximum undo stack depth. Default: 50. */
  maxUndoDepth?: number;
}

export interface UseTextInputResult {
  /** Current cursor state (text + position). */
  cursor: Cursor;
  /** Shortcut for cursor.text. */
  value: string;
  /**
   * Process a keyboard event. Returns true if the event was consumed.
   * Call this from the parent's useInput handler.
   *
   * Does NOT handle: Enter, Escape, Tab, ↑↓ arrows — leave those to the parent.
   */
  handleInput: (input: string, key: Key) => boolean;
  /** Reset to a new value (cursor at end). */
  reset: (newValue?: string) => void;
  /** Set value programmatically (cursor at end). Clears undo. */
  setValue: (value: string) => void;
  /** Set cursor directly (for external state sync). */
  setCursor: (cursor: Cursor) => void;
}

const UNDO_SNAPSHOT_DEBOUNCE_MS = 500;

export function useTextInput(opts: UseTextInputOptions = {}): UseTextInputResult {
  const maxUndo = opts.maxUndoDepth ?? 50;

  const [cursor, setCursorState] = useState<Cursor>(
    () => new Cursor(opts.initialValue ?? ''),
  );

  // Undo stack — useRef to avoid re-renders on snapshots
  const undoStack = useRef<Cursor[]>([]);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kill ring — last killed text for Ctrl+Y
  const killRing = useRef<string>('');

  // Stable ref to current cursor for use in callbacks
  const cursorRef = useRef<Cursor>(cursor);
  cursorRef.current = cursor;

  const setCursor = useCallback((c: Cursor) => {
    cursorRef.current = c;
    setCursorState(c);
  }, []);

  /** Take an immediate undo snapshot of the current state. */
  const snapshotUndo = useCallback(() => {
    if (snapshotTimer.current) {
      clearTimeout(snapshotTimer.current);
      snapshotTimer.current = null;
    }
    const stack = undoStack.current;
    const cur = cursorRef.current;
    // Don't push duplicate snapshots
    if (stack.length > 0 && stack[stack.length - 1]!.text === cur.text) return;
    stack.push(cur);
    if (stack.length > maxUndo) stack.shift();
  }, [maxUndo]);

  /** Schedule a debounced undo snapshot (for regular typing). */
  const debouncedSnapshot = useCallback(() => {
    if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
    snapshotTimer.current = setTimeout(() => {
      snapshotTimer.current = null;
      snapshotUndo();
    }, UNDO_SNAPSHOT_DEBOUNCE_MS);
  }, [snapshotUndo]);

  const handleInput = useCallback((input: string, key: Key): boolean => {
    // Guard: empty input events from modifier keys / IME switching
    // These should NOT be processed as character input
    if (!input && !key.backspace && !key.delete && !key.leftArrow && !key.rightArrow &&
        !key.home && !key.end) {
      return false;
    }

    const c = cursorRef.current;

    // ── Ctrl shortcuts ──────────────────────────────

    if (key.ctrl) {
      switch (input) {
        case 'a': // Move to start of line
          setCursor(c.moveToStart());
          return true;
        case 'e': // Move to end of line
          setCursor(c.moveToEnd());
          return true;
        case 'k': { // Kill to end
          snapshotUndo();
          const [newCursor, killed] = c.killToEnd();
          killRing.current = killed;
          setCursor(newCursor);
          return true;
        }
        case 'u': { // Kill to start
          snapshotUndo();
          const [newCursor, killed] = c.killToStart();
          killRing.current = killed;
          setCursor(newCursor);
          return true;
        }
        case 'w': { // Kill word back
          snapshotUndo();
          const [newCursor, killed] = c.killWordBack();
          killRing.current = killed;
          setCursor(newCursor);
          return true;
        }
        case 'y': // Yank (paste from kill ring)
          if (killRing.current) {
            snapshotUndo();
            setCursor(c.insert(killRing.current));
          }
          return true;
        case 'z': { // Undo — skip snapshots matching current state
          const stack = undoStack.current;
          // Skip at most one snapshot matching current state (debounced checkpoint)
          if (stack.length > 0 && stack[stack.length - 1]!.text === c.text) {
            stack.pop();
          }
          if (stack.length > 0) {
            setCursor(stack.pop()!);
          }
          return true;
        }
        case 'b': // Move left (Ctrl+B = Emacs left)
          setCursor(c.moveLeft());
          return true;
        case 'f': // Move right (Ctrl+F = Emacs right)
          setCursor(c.moveRight());
          return true;
        case 'd': // Delete forward
          if (!c.isEmpty) {
            debouncedSnapshot();
            setCursor(c.deleteForward());
          }
          return true;
        case 'h': // Backspace (Ctrl+H)
          if (c.pos > 0) {
            debouncedSnapshot();
            setCursor(c.deleteBack());
          }
          return true;
        default:
          return false;
      }
    }

    // ── Meta/Cmd shortcuts ──────────────────────────

    if (key.meta) {
      // Cmd+Z — undo (skip snapshots matching current state)
      if (input === 'z') {
        const stack = undoStack.current;
        while (stack.length > 0 && stack[stack.length - 1]!.text === c.text) {
          stack.pop();
        }
        if (stack.length > 0) {
          setCursor(stack.pop()!);
        }
        return true;
      }
      // Cmd+A — move to start (terminal convention, not "select all")
      if (input === 'a') {
        setCursor(c.moveToStart());
        return true;
      }
      // Cmd+Backspace — kill to start of line
      if (key.backspace || key.delete) {
        snapshotUndo();
        const [newCursor, killed] = c.killToStart();
        killRing.current = killed;
        setCursor(newCursor);
        return true;
      }
      // Option+Left / Meta+B — word back
      if (key.leftArrow || input === 'b') {
        setCursor(c.moveToWordBack());
        return true;
      }
      // Option+Right / Meta+F — word forward
      if (key.rightArrow || input === 'f') {
        setCursor(c.moveToWordForward());
        return true;
      }
      // Don't consume other meta combinations
      return false;
    }

    // ── Home / End ──────────────────────────────────

    if (key.home) {
      setCursor(c.moveToStart());
      return true;
    }
    if (key.end) {
      setCursor(c.moveToEnd());
      return true;
    }

    // ── Arrow keys ──────────────────────────────────

    if (key.leftArrow) {
      setCursor(c.moveLeft());
      return true;
    }
    if (key.rightArrow) {
      setCursor(c.moveRight());
      return true;
    }

    // ── Backspace / Delete ────────────────────────────
    // Ink 6.8 maps \x7F (physical Backspace key) to key.delete, not key.backspace.
    // Both should delete backward. Forward-delete is handled by Ctrl+D.

    if (key.backspace || key.delete) {
      if (c.pos > 0) {
        debouncedSnapshot();
        setCursor(c.deleteBack());
      }
      return true;
    }

    // ── Regular character input ─────────────────────

    if (input && !key.escape) {
      debouncedSnapshot();
      setCursor(c.insert(input));
      return true;
    }

    return false;
  }, [setCursor, snapshotUndo, debouncedSnapshot]);

  const reset = useCallback((newValue?: string) => {
    const c = new Cursor(newValue ?? '');
    setCursor(c);
    undoStack.current = [];
    if (snapshotTimer.current) {
      clearTimeout(snapshotTimer.current);
      snapshotTimer.current = null;
    }
  }, [setCursor]);

  const setValue = useCallback((value: string) => {
    setCursor(new Cursor(value));
    undoStack.current = [];
  }, [setCursor]);

  return {
    cursor,
    value: cursor.text,
    handleInput,
    reset,
    setValue,
    setCursor,
  };
}
