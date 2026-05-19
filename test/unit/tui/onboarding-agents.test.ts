/**
 * Onboarding invariant: the Agents onboarding tip must enumerate every
 * adapter ORCH ships. If a new adapter is added to SUPPORTED_ADAPTERS but
 * not mentioned in the tip, new users won't know it exists.
 */

import { describe, it, expect } from 'vitest';
import { ONBOARDING_AGENTS } from '../../../src/tui/onboarding-config.js';
import { SUPPORTED_ADAPTERS } from '../../../src/domain/model-tiers.js';

describe('ONBOARDING_AGENTS', () => {
  it('lists every adapter from SUPPORTED_ADAPTERS', () => {
    const joined = ONBOARDING_AGENTS.description.join(' ').toLowerCase();
    for (const adapter of SUPPORTED_ADAPTERS) {
      expect(joined, `adapter "${adapter}" must appear in the onboarding tip`).toContain(adapter);
    }
  });

  it('keeps the description at most 3 lines so it fits the onboarding box', () => {
    expect(ONBOARDING_AGENTS.description.length).toBeLessThanOrEqual(3);
  });
});
