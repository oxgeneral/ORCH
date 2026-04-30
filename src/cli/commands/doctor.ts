/**
 * `orch doctor` command.
 *
 * Diagnostics: check adapters, dependencies, project state.
 * Works both with and without a full container (pre-init).
 */

import type { Command } from 'commander';
import type { Container } from '../../container.js';
import { ProcessManager } from '../../infrastructure/process/process-manager.js';
import { AdapterRegistry } from '../../infrastructure/adapters/registry.js';
import { ClaudeAdapter } from '../../infrastructure/adapters/claude.js';
import { ShellAdapter } from '../../infrastructure/adapters/shell.js';
import { PiAdapter } from '../../infrastructure/adapters/pi.js';
import { DoctorService } from '../../application/doctor-service.js';
import { Paths } from '../../infrastructure/storage/paths.js';
import { getIcon, amber, dim } from '../output.js';
import chalk from 'chalk';

export function registerDoctorCommand(program: Command, container?: Container): void {
  program
    .command('doctor')
    .description('Check adapters and dependencies')
    .action(async () => {
      // Build minimal dependencies if no container
      let doctorService: DoctorService;
      let paths: Paths | undefined;
      let hasContainer = false;

      if (container) {
        doctorService = container.doctorService;
        paths = container.paths;
        hasContainer = true;
      } else {
        const pm = new ProcessManager();
        const registry = new AdapterRegistry();
        registry.register(new ClaudeAdapter(pm));
        registry.register(new ShellAdapter(pm));
        registry.register(new PiAdapter(pm));
        doctorService = new DoctorService(registry, pm, process.cwd());
        paths = new Paths(process.cwd());
      }

      console.log();
      console.log(`  ${amber('orch doctor')} · checking adapters and dependencies`);
      console.log();

      const report = await doctorService.runAll();

      if (container?.context.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      for (const check of report.checks) {
        const icon =
          check.status === 'ok'
            ? chalk.ansi256(72)(getIcon('done'))
            : check.status === 'fail'
              ? chalk.ansi256(167)(getIcon('failed'))
              : dim('—');

        const detail = check.detail ? dim(` ${check.detail}`) : '';
        console.log(`  ${icon}  ${check.name.padEnd(12)}${detail}`);
      }

      // Project state
      if (paths) {
        const initialized = await paths.isInitialized();
        if (initialized && hasContainer) {
          const agents = await container!.agentService.list();
          const tasks = await container!.taskService.list();
          console.log();
          console.log(
            `  ${chalk.ansi256(72)(getIcon('done'))}  .orchestry/   ${dim(`exists · ${agents.length} agents · ${tasks.length} tasks`)}`,
          );
        } else if (!initialized) {
          console.log();
          console.log(
            `  ${chalk.ansi256(167)(getIcon('failed'))}  .orchestry/   ${dim('not found — run: orch init')}`,
          );
        }
      }

      console.log();
      console.log(
        `  ${report.adaptersReady} of ${report.adaptersTotal} adapters ready`,
      );
      console.log();
    });
}
