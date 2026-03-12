/**
 * CLI entry point.
 *
 * Builds the container, registers all commands, handles global errors.
 */

import { Command } from 'commander';
import { createContext } from '../cli/context.js';
import { buildContainer } from '../container.js';
import { OrchestryError, NotInitializedError } from '../domain/errors.js';
import { printError, setAsciiMode, setNoColor } from '../cli/output.js';

import { registerInitCommand } from '../cli/commands/init.js';
import { registerTaskCommand } from '../cli/commands/task.js';
import { registerAgentCommand } from '../cli/commands/agent.js';
import { registerRunCommand } from '../cli/commands/run.js';
import { registerStatusCommand } from '../cli/commands/status.js';
import { registerLogsCommand } from '../cli/commands/logs.js';
import { registerConfigCommand } from '../cli/commands/config.js';
import { registerDoctorCommand } from '../cli/commands/doctor.js';
import { registerTuiCommand } from '../cli/commands/tui.js';
import { registerContextCommand } from '../cli/commands/context.js';
import { registerMsgCommand } from '../cli/commands/msg.js';
import { registerGoalCommand } from '../cli/commands/goal.js';
import { registerTeamCommand } from '../cli/commands/team.js';

const program = new Command();

program
  .name('orchestry')
  .description('Agents Organizations — CLI orchestrator for AI agents')
  .version('0.1.0')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output (IDs only)')
  .option('--no-color', 'Disable colors')
  .option('--ascii', 'ASCII-only output (no Unicode)')
  .hook('preAction', async (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.ascii) setAsciiMode(true);
    if (opts.color === false) setNoColor(true);
  });

async function main(): Promise<void> {
  // Parse global options first
  program.parseOptions(process.argv);
  const globalOpts = program.opts();

  const context = createContext({
    json: globalOpts.json,
    quiet: globalOpts.quiet,
    noColor: globalOpts.color === false, // Commander handles --no-color as color=false
    ascii: globalOpts.ascii,
  });

  // Commands that work without a full container
  registerInitCommand(program);

  // Build container for other commands (requires .orchestry/ to read config)
  let container;
  try {
    container = await buildContainer(context);
  } catch (err) {
    if (err instanceof NotInitializedError) {
      // Not initialized — only init and doctor work without container
      registerDoctorCommand(program);

      // No args → show welcome message instead of cryptic error
      if (process.argv.length <= 2) {
        const { dim } = await import('../cli/output.js');
        console.log();
        console.log(`  ${dim('orchestry')} — CLI orchestrator for AI agents`);
        console.log();
        console.log(`  Get started:`);
        console.log(`    $ orch init`);
        console.log();
        console.log(`  ${dim('This will create .orchestry/ in the current directory.')}`);
        console.log();
        return;
      }

      // Check if user is running init or doctor — let Commander handle it
      const sub = process.argv[2];
      if (sub === 'init' || sub === 'doctor') {
        await program.parseAsync(process.argv);
        return;
      }

      // Any other command → show "Not initialized" error
      printError(err.message, err.hint);
      process.exit(err.exitCode);
    }
    throw err;
  }

  // Register all commands
  registerTaskCommand(program, container);
  registerAgentCommand(program, container);
  registerRunCommand(program, container);
  registerStatusCommand(program, container);
  registerLogsCommand(program, container);
  registerConfigCommand(program, container);
  registerContextCommand(program, container);
  registerMsgCommand(program, container);
  registerGoalCommand(program, container);
  registerTeamCommand(program, container);
  registerDoctorCommand(program, container);
  registerTuiCommand(program, container);

  // Default command (no args) → TUI dashboard
  if (process.argv.length <= 2) {
    process.argv.push('tui');
  }

  await program.parseAsync(process.argv);
}

// Global error boundary
main().catch((err) => {
  if (err instanceof OrchestryError) {
    printError(err.message, err.hint);
    process.exit(err.exitCode);
  }

  printError(
    err instanceof Error ? err.message : String(err),
  );

  if (process.env['ORCHESTRY_DEBUG']) {
    console.error(err);
  }

  process.exit(1);
});
