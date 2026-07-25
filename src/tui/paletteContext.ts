import { createContext, useContext } from 'react';
import type { TuiPaletteName } from '../domain/global-config.js';

export const TuiPaletteContext = createContext<TuiPaletteName>('amber');

/** Subscribe a memoized component to live palette changes. */
export function useTuiPalette(): TuiPaletteName {
  return useContext(TuiPaletteContext);
}
