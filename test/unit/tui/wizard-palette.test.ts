import { describe, expect, it } from 'vitest';
import { getConfigWizardSteps } from '../../../src/tui/wizardConfigs.js';

describe('config wizard palette setting', () => {
  it('opens the global color palette as its own one-step wizard', () => {
    const steps = getConfigWizardSteps(
      'palette',
      'ocean',
      'all',
      6,
      { toast: true, bell: false },
    );

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      id: 'palette',
      label: 'Color palette',
      type: 'select',
      defaultValue: 'ocean',
    });
    expect(steps[0]!.options?.map((option) => option.value)).toEqual([
      'amber',
      'ocean',
      'forest',
      'violet',
    ]);
  });

  it('opens every other config item as its own one-step wizard', () => {
    const settings = [
      ['activity-filter', 'activity_filter'],
      ['max-concurrent', 'max_concurrent'],
      ['notifications-toast', 'notifications_toast'],
      ['notifications-bell', 'notifications_bell'],
    ] as const;

    for (const [setting, field] of settings) {
      const steps = getConfigWizardSteps(
        setting,
        'amber',
        'all',
        6,
        { toast: true, bell: false },
      );
      expect(steps).toHaveLength(1);
      expect(steps[0]!.id).toBe(field);
    }
  });
});
