/**
 * Animated braille spinner for running tasks.
 *
 * Cycles through braille pattern frames at 80ms intervals.
 * Only animates when mounted — zero overhead when not used.
 */

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
//               ⠋        ⠙        ⠹        ⠸        ⠼        ⠴        ⠦        ⠧        ⠇        ⠏

const INTERVAL = 80;

export interface SpinnerProps {
  color?: string;
}

export function Spinner({ color }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % FRAMES.length);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return <Text color={color}>{FRAMES[frame]}</Text>;
}
