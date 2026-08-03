import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUpdateCommand } from '../../../src/cli/commands/update.js';

describe('update command', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints the explicit secured-fork procedure without installing anything', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerUpdateCommand(program);

    await program.parseAsync(['update'], { from: 'user' });

    expect(log).toHaveBeenCalledWith('This secured private fork never installs updates automatically.');
    expect(log).toHaveBeenCalledWith('Use the commit-pinned GitHub installation command from the README.');
  });
});
