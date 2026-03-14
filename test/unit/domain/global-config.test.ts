/**
 * Tests for global-config domain: DEFAULT_GLOBAL_CONFIG notifications defaults.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_GLOBAL_CONFIG } from '../../../src/domain/global-config.js';

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
});
