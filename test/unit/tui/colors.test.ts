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

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/../g);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received "${hex}"`);
  }
  const [red, green, blue] = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it('preserves distinct gray and ghost tokens when leaving the light palette', () => {
    expect(remapTuiColor(TUI_PALETTES.light.gray, 'light', 'amber'))
      .toBe(TUI_PALETTES.amber.gray);
    expect(remapTuiColor(TUI_PALETTES.light.ghost, 'light', 'amber'))
      .toBe(TUI_PALETTES.amber.ghost);
  });

  it('provides a high-contrast palette for light terminals', () => {
    applyTuiPalette('light');

    expect(tuiColors.white).toBe('#1d2939');
    expect(tuiColors.ghost).toBe('#667085');
    expect(tuiColors.alternatingRowBg).toBe('#f8fafc');
  });

  it.each(['amber', 'green', 'red', 'blue'] as const)(
    'keeps solid text readable on the light palette %s fill',
    (fill) => {
      expect(contrastRatio(TUI_PALETTES.light.solidText, TUI_PALETTES.light[fill]))
        .toBeGreaterThanOrEqual(4.5);
    },
  );
});
