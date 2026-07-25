import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTuiPalette,
  getActiveTuiPalette,
  getAgentColors,
  GOAL_STATUS_COLOR,
  remapTuiColor,
  TASK_STATUS_COLOR,
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
    expect(getActiveTuiPalette()).toBe('ocean');
    expect(tuiColors.amber).toBe(TUI_PALETTES.ocean.amber);
    expect(tuiColors.accentBg).toBe(TUI_PALETTES.ocean.accentBg);
  });

  it('refreshes derived status and agent colors', () => {
    applyTuiPalette('forest');

    expect(TASK_STATUS_COLOR.in_progress).toBe(TUI_PALETTES.forest.green);
    expect(GOAL_STATUS_COLOR.achieved).toBe(TUI_PALETTES.forest.amber);
    expect(getAgentColors()[0]).toBe(TUI_PALETTES.forest.green);
  });

  it('remaps existing semantic message colors during a live switch', () => {
    expect(remapTuiColor(TUI_PALETTES.amber.red, 'amber', 'violet'))
      .toBe(TUI_PALETTES.violet.red);
    expect(remapTuiColor('#123456', 'amber', 'violet')).toBe('#123456');
  });
});
