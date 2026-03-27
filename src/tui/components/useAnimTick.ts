/**
 * Global animation tick — single setInterval drives all TUI animations.
 *
 * Without this, each Spinner/MiniSpinner/ScannerBar owns its own timer,
 * producing N independent re-renders per tick. With a shared tick,
 * all animations advance in a single React update cycle.
 *
 * Tick rate: 120ms (~8 FPS) — fast enough for smooth braille spinners,
 * slow enough to avoid terminal flicker from Ink's full-stdout redraw.
 */

import { useState, useEffect } from 'react';

const TICK_INTERVAL = 120;

/** Subscribers receive a monotonically increasing tick counter. */
type TickListener = (tick: number) => void;

let globalTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<TickListener>();

function startGlobal(): void {
  if (timer) return;
  timer = setInterval(() => {
    globalTick++;
    for (const fn of listeners) fn(globalTick);
  }, TICK_INTERVAL);
}

function stopGlobal(): void {
  if (timer && listeners.size === 0) {
    clearInterval(timer);
    timer = null;
  }
}

/** Reset global state — for tests only. */
export function _resetAnimTick(): void {
  if (timer) { clearInterval(timer); timer = null; }
  listeners.clear();
  globalTick = 0;
}

/**
 * Hook: subscribe to the global animation tick.
 * Returns the current tick number (increments every 120ms).
 * The global timer starts when the first subscriber mounts
 * and stops when the last one unmounts.
 *
 * Pass `enabled = false` to unsubscribe without unmounting —
 * the component stops driving redraws while idle.
 */
export function useAnimTick(enabled: boolean = true): number {
  const [tick, setTick] = useState(globalTick);

  useEffect(() => {
    if (!enabled) return;
    setTick(globalTick);
    const listener: TickListener = (t) => setTick(t);
    listeners.add(listener);
    startGlobal();
    return () => {
      listeners.delete(listener);
      stopGlobal();
    };
  }, [enabled]);

  return tick;
}
