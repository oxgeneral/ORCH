/**
 * TUI ToastBanner — notification toasts for task completion events.
 *
 * Shows up to 2 toasts stacked vertically between content and UndoBanner.
 * Auto-dismisses: done=4s, failed=8s, review=6s.
 * Fade animation: dim text during first 360ms (fade-in) and last 360ms (fade-out).
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { tuiColors, LOZENGE } from '../colors.js';
import { useTuiPalette } from '../paletteContext.js';

/* ── Types ───────────────────────────────────────── */

export type ToastType = 'done' | 'failed' | 'review';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  agentName?: string;
  ts: number;
}

export interface ToastBannerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/* ── Constants ───────────────────────────────────── */

const MAX_VISIBLE = 2;

/** Fade duration in ms for enter/exit animation. */
const FADE_MS = 360;

const AUTO_DISMISS_MS: Record<ToastType, number> = {
  done: 4000,
  failed: 8000,
  review: 6000,
};

const ICON: Record<ToastType, string> = {
  done: '\u2713',   // ✓
  failed: '\u2715', // ✕
  review: LOZENGE,  // ◈
};

/* ── Helpers ─────────────────────────────────────── */

function toastMessage(toast: Toast): string {
  const agent = toast.agentName ?? 'Agent';
  switch (toast.type) {
    case 'done':
      return `Task completed by ${agent}`;
    case 'failed':
      return 'Task failed \u2014 press Enter for details';
    case 'review':
      return 'Task ready for review \u2014 press A to approve';
  }
}

/* ── Single Toast Row ────────────────────────────── */

interface ToastRowProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastRow = React.memo(function ToastRow({ toast, onDismiss }: ToastRowProps) {
  useTuiPalette();
  const [fadingIn, setFadingIn] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);

  // Fade-in: dim → full after FADE_MS
  useEffect(() => {
    const t = setTimeout(() => setFadingIn(false), FADE_MS);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss: start fade-out, then call onDismiss
  useEffect(() => {
    const dismissDelay = AUTO_DISMISS_MS[toast.type];
    const fadeOutTimer = setTimeout(() => setFadingOut(true), dismissDelay);
    const removeTimer = setTimeout(() => onDismiss(toast.id), dismissDelay + FADE_MS);
    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.type, onDismiss]);

  const dimmed = fadingIn || fadingOut;

  const icon = ICON[toast.type];
  const fg = toast.type === 'done'
    ? tuiColors.green
    : toast.type === 'failed'
      ? tuiColors.red
      : tuiColors.blue;
  const bg = toast.type === 'done'
    ? tuiColors.successBg
    : toast.type === 'failed'
      ? tuiColors.errorBg
      : tuiColors.infoBg;
  const msg = toastMessage(toast);
  const title = toast.title.length > 40
    ? toast.title.slice(0, 39) + '\u2026'
    : toast.title;

  return (
    <Box>
      <Text backgroundColor={bg}>
        <Text color={dimmed ? tuiColors.dim : fg}> {icon} </Text>
        <Text color={dimmed ? tuiColors.dim : tuiColors.white} bold={!dimmed}>{title}</Text>
        <Text color={dimmed ? tuiColors.dim : tuiColors.silver}> {msg} </Text>
      </Text>
    </Box>
  );
});

/* ── Banner ──────────────────────────────────────── */

export const ToastBanner = React.memo(function ToastBanner({ toasts, onDismiss }: ToastBannerProps) {
  const visible = toasts.slice(0, MAX_VISIBLE);

  if (visible.length === 0) return null;

  return (
    <Box flexDirection="column">
      {visible.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </Box>
  );
});
