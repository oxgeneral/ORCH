import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTuiPalette,
  getAgentColors,
  getGoalStatusColor,
  getTaskStatusColor,
  remapTuiColor,
  TUI_PALETTES,
  tuiColors,
} from '../../../src/tui/colors.js';

afterEach(() => {
  applyTuiPalette('amber');
});

describe('TUI color palettes', () => {
  it('applies a palette in place so existing imports see live colors', () => {
    const colorsRef = tuiColors;

    applyTuiPalette('ocean');

    expect(tuiColors).toBe(colorsRef);
    expect(tuiColors.amber).toBe(TUI_PALETTES.ocean.amber);
    expect(tuiColors.accentBg).toBe(TUI_PALETTES.ocean.accentBg);
  });

  it('refreshes derived status and agent colors', () => {
    applyTuiPalette('forest');

    expect(getTaskStatusColor('in_progress')).toBe(TUI_PALETTES.forest.green);
    expect(getGoalStatusColor('achieved')).toBe(TUI_PALETTES.forest.amber);
    expect(getAgentColors()[0]).toBe(TUI_PALETTES.forest.green);
  });

  it('remaps existing semantic message colors during a live switch', () => {
    expect(remapTuiColor(TUI_PALETTES.amber.red, 'amber', 'violet'))
      .toBe(TUI_PALETTES.violet.red);
    expect(remapTuiColor('#123456', 'amber', 'violet')).toBe('#123456');
  });

  it('provides a high-contrast palette for light terminals', () => {
    applyTuiPalette('light');

    expect(tuiColors.white).toBe('#1d2939');
    expect(tuiColors.ghost).toBe('#667085');
    expect(tuiColors.alternatingRowBg).toBe('#f8fafc');
  });
});
