/**
 * Animated braille spinner for running tasks.
 *
 * Uses the global animation tick (shared 120ms interval)
 * instead of its own setInterval — eliminates per-instance
 * timer overhead that caused terminal flicker.
 */

import React from 'react';
import { Text } from 'ink';
import { useAnimTick } from './useAnimTick.js';

const FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
//               ⠋        ⠙        ⠹        ⠸        ⠼        ⠴        ⠦        ⠧        ⠇        ⠏

export interface SpinnerProps {
  color?: string;
}

export function Spinner({ color }: SpinnerProps) {
  const tick = useAnimTick();
  return <Text color={color}>{FRAMES[tick % FRAMES.length]}</Text>;
}
