/**
 * Tests for global-config domain: DEFAULT_GLOBAL_CONFIG notifications defaults.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GLOBAL_CONFIG,
  isTuiPaletteName,
  TUI_PALETTE_NAMES,
} from '../../../src/domain/global-config.js';

describe('DEFAULT_GLOBAL_CONFIG', () => {
  it('has notifications.toast=true by default', () => {
    expect(DEFAULT_GLOBAL_CONFIG.tui.notifications.toast).toBe(true);
  });

  it('has notifications.bell=false by default', () => {
    expect(DEFAULT_GLOBAL_CONFIG.tui.notifications.bell).toBe(false);
  });

  it('has activity_filter=all by default', () => {
    expect(DEFAULT_GLOBAL_CONFIG.tui.activity_filter).toBe('all');
  });

  it('has palette=amber by default', () => {
    expect(DEFAULT_GLOBAL_CONFIG.tui.palette).toBe('amber');
  });

  it('validates every built-in palette name', () => {
    expect(TUI_PALETTE_NAMES).toEqual(['amber', 'ocean', 'forest', 'violet', 'light']);
    for (const palette of TUI_PALETTE_NAMES) {
      expect(isTuiPaletteName(palette)).toBe(true);
    }
    expect(isTuiPaletteName('unknown')).toBe(false);
    expect(isTuiPaletteName(null)).toBe(false);
  });
});
