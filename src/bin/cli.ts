/**
 * CLI entry point.
 *
 * Builds the container, registers all commands, handles global errors.
 * Uses light container (stores + services) for read-only commands,
 * full container (+ orchestrator + adapters + LiquidJS) for run/tui/doctor.
 */

import { Command } from 'commander';
import { createContext } from '../cli/context.js';
import type { LightContainer, Container } from '../container.js';
import { OrchestryError, NotInitializedError } from '../domain/errors.js';
import { printError, setAsciiMode, setNoColor } from '../cli/output.js';

/** Commands that only need stores + services (fast path). */
const LIGHT_COMMANDS: Record<string, (program: Command, container: LightContainer) => Promise<void>> = {
  task:    async (p, c) => { const m = await import('../cli/commands/task.js');    m.registerTaskCommand(p, c); },
  agent:   async (p, c) => { const m = await import('../cli/commands/agent.js');   m.registerAgentCommand(p, c); },
  status:  async (p, c) => { const m = await import('../cli/commands/status.js');  m.registerStatusCommand(p, c); },
  logs:    async (p, c) => { const m = await import('../cli/commands/logs.js');    m.registerLogsCommand(p, c); },
  config:  async (p, c) => { const m = await import('../cli/commands/config.js');  m.registerConfigCommand(p, c); },
  context: async (p, c) => { const m = await import('../cli/commands/context.js'); m.registerContextCommand(p, c); },
  msg:     async (p, c) => { const m = await import('../cli/commands/msg.js');     m.registerMsgCommand(p, c); },
  goal:    async (p, c) => { const m = await import('../cli/commands/goal.js');    m.registerGoalCommand(p, c); },
  team:    async (p, c) => { const m = await import('../cli/commands/team.js');    m.registerTeamCommand(p, c); },
};

/** Commands that need orchestrator + adapters + template engine (heavy path). */
const FULL_COMMANDS: Record<string, (program: Command, container: Container) => Promise<void>> = {
  run:     async (p, c) => { const m = await import('../cli/commands/run.js');     m.registerRunCommand(p, c); },
  doctor:  async (p, c) => { const m = await import('../cli/commands/doctor.js');  m.registerDoctorCommand(p, c); },
  tui:     async (p, c) => { const m = await import('../cli/commands/tui.js');     m.registerTuiCommand(p, c); },
};

const program = new Command();

program
  .name('orchestry')
  .description('Agents Organizations — CLI orchestrator for AI agents')
  .version('0.3.0')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output (IDs only)')
  .option('--no-color', 'Disable colors')
  .option('--ascii', 'ASCII-only output (no Unicode)')
  .hook('preAction', async (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.ascii) setAsciiMode(true);
    if (opts.color === false) setNoColor(true);
  });

/** All known subcommand names for help stub registration. */
const COMMAND_STUBS: Array<[name: string, description: string]> = [
  ['task',    'Manage tasks'],
  ['agent',   'Manage agents'],
  ['status',  'Show orchestrator status'],
  ['logs',    'View run logs'],
  ['config',  'Manage configuration'],
  ['context', 'Shared context store for inter-agent data exchange'],
  ['msg',     'Inter-agent messaging'],
  ['goal',    'Manage goals'],
  ['team',    'Manage teams'],
  ['run',     'Run tasks'],
  ['doctor',  'Check adapters and dependencies'],
  ['tui',     'Launch TUI dashboard'],
  ['init',    'Initialize project'],
  ['update',  'Check for updates'],
];

/** Set of all known subcommand names (derived from COMMAND_STUBS). */
const ALL_KNOWN_COMMANDS = new Set(COMMAND_STUBS.map(([name]) => name));

async function main(): Promise<void> {
  // Parse global options first
  program.parseOptions(process.argv);
  const globalOpts = program.opts();

  const context = createContext({
    json: globalOpts.json,
    quiet: globalOpts.quiet,
    noColor: globalOpts.color === false,
    ascii: globalOpts.ascii,
  });

  // Determine which subcommand the user wants (before loading anything heavy).
  // Skip leading flags like --json/--quiet to find the real subcommand name.
  const sub = process.argv.slice(2).find((arg) => !arg.startsWith('-'));

  // Fast path: --help/--version without a real subcommand skip container init entirely
  const hasRealSub = sub !== undefined && ALL_KNOWN_COMMANDS.has(sub);
  const isHelpOrVersion = process.argv.includes('--help') || process.argv.includes('-h')
    || process.argv.includes('--version') || process.argv.includes('-V');

  if (isHelpOrVersion && !hasRealSub) {
    // Register lightweight stubs so Commander can display help with all command names
    for (const [name, desc] of COMMAND_STUBS) {
      program.command(name).description(desc);
    }
    await program.parseAsync(process.argv);
    return;
  }

  // Commands that work without a container (lazy-loaded)
  if (sub === 'init') {
    const { registerInitCommand } = await import('../cli/commands/init.js');
    registerInitCommand(program);
  } else if (sub === 'update') {
    const { registerUpdateCommand } = await import('../cli/commands/update.js');
    registerUpdateCommand(program);
  }

  // Decide: light or full container
  const needsFull = !sub || sub in FULL_COMMANDS;

  // Pre-load container module so it's available in both try and catch paths
  const { buildFullContainer, buildLightContainer } = await import('../container.js');

  try {
    if (needsFull) {
      // Full container: orchestrator + adapters + LiquidJS
      const container = await buildFullContainer(context);

      // Register requested full command (or all if unknown sub)
      const fullLoader = sub ? FULL_COMMANDS[sub] : undefined;
      if (fullLoader) {
        await fullLoader(program, container);
      } else {
        // No sub → TUI, register all full commands
        await Promise.all(
          Object.values(FULL_COMMANDS).map((fn) => fn(program, container)),
        );
      }

      // Also register light commands that may be needed (help, unknown sub fallback)
      // Full container extends LightContainer, so it works
      const lightLoader = sub ? LIGHT_COMMANDS[sub] : undefined;
      if (lightLoader) {
        await lightLoader(program, container);
      }
    } else {
      // Light container: stores + services only (no ProcessManager, no adapters, no LiquidJS)
      const container = await buildLightContainer(context);

      const lightLoader = LIGHT_COMMANDS[sub];
      if (lightLoader) {
        await lightLoader(program, container);
      } else {
        // Unknown subcommand — register all light commands so Commander can show help/error
        await Promise.all(
          Object.values(LIGHT_COMMANDS).map((fn) => fn(program, container)),
        );
      }
    }
  } catch (err) {
    if (err instanceof NotInitializedError) {
      // Not initialized — only init, doctor, and update work without container
      if (sub === 'doctor') {
        const { registerDoctorCommand } = await import('../cli/commands/doctor.js');
        registerDoctorCommand(program);
      }

      // No args → auto-init then launch TUI
      if (process.argv.length <= 2) {
        const { runInit } = await import('../cli/commands/init.js');
        await runInit();

        // Build full container now that .orchestry/ exists, register only tui
        const freshContainer = await buildFullContainer(context);
        await FULL_COMMANDS['tui']!(program, freshContainer);
        await program.parseAsync([...process.argv, 'tui']);
        return;
      }

      // Check if user is running init, doctor, or update — let Commander handle it
      if (sub === 'init' || sub === 'doctor' || sub === 'update') {
        await program.parseAsync(process.argv);
        return;
      }

      // Any other command → show "Not initialized" error
      printError(err.message, err.hint);
      process.exit(err.exitCode);
    }
    throw err;
  }

  // Default command (no args) → TUI dashboard
  if (process.argv.length <= 2) {
    process.argv.push('tui');
  }

  // Start background update check (cache-only — never blocks CLI).
  // TUI and update commands handle their own checks.
  let updateMod: typeof import('../cli/update-check.js') | undefined;
  const skipUpdateCheck = sub === 'tui' || sub === 'update';
  const updateCheck = skipUpdateCheck
    ? Promise.resolve(null)
    : import('../cli/update-check.js').then((m) => {
        updateMod = m;
        return m.checkForUpdateSWR(program.version() ?? '0.0.0');
      });

  await program.parseAsync(process.argv);

  // Show update notification after command completes
  if (!skipUpdateCheck) {
    const info = await updateCheck;
    if (info && updateMod) updateMod.printUpdateNotification(info);
  }
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
