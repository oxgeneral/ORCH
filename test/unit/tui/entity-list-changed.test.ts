import { describe, expect, it } from 'vitest';
import { entityListChanged } from '../../../src/tui/App.js';

describe('entityListChanged', () => {
  it('detects changes to agents without updated_at timestamps', () => {
    const previous = [{ id: 'agt_1', adapter: 'claude', config: { model: 'claude-sonnet-4-6' } }];
    const current = [{ id: 'agt_1', adapter: 'codex', config: { model: 'gpt-5.6-terra' } }];

    expect(entityListChanged(previous, current)).toBe(true);
  });

  it('ignores identical timestamp-less entities loaded as fresh objects', () => {
    const previous = [{ id: 'agt_1', adapter: 'codex', config: { model: 'gpt-5.6-terra' } }];
    const current = [{ id: 'agt_1', adapter: 'codex', config: { model: 'gpt-5.6-terra' } }];

    expect(entityListChanged(previous, current)).toBe(false);
  });
});
