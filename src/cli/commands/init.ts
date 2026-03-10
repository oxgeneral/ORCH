/**
 * `orch init` command.
 *
 * Creates .orchestry/ scaffold in the current directory.
 */

import type { Command } from 'commander';
import path from 'node:path';
import { Paths } from '../../infrastructure/storage/paths.js';
import { ensureDir, pathExists } from '../../infrastructure/storage/fs-utils.js';
import { writeYaml, atomicWrite } from '../../infrastructure/storage/fs-utils.js';
import { DEFAULT_CONFIG } from '../../domain/config.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../../infrastructure/template/template-engine.js';
import { printSuccess, printWarning, dim } from '../output.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize .orchestry/ in the current directory')
    .option('--name <name>', 'Project name')
    .action(async (opts: { name?: string }) => {
      const projectRoot = process.cwd();
      const paths = new Paths(projectRoot);

      if (await pathExists(paths.root)) {
        printWarning('Already initialized');
        return;
      }

      // Create directory structure
      await ensureDir(paths.tasksDir);
      await ensureDir(paths.agentsDir);
      await ensureDir(paths.runsDir);
      await ensureDir(paths.templatesDir);
      await ensureDir(paths.logsDir);

      // Write config
      const config = { ...DEFAULT_CONFIG };
      if (opts.name) {
        config.project.name = opts.name;
      } else {
        config.project.name = path.basename(projectRoot);
      }
      await writeYaml(paths.configPath, config);

      // Write .gitignore
      await atomicWrite(
        paths.gitignorePath,
        [
          '# Runtime state',
          'state.json',
          '*.lock',
          '',
          '# Logs and runs',
          'runs/',
          'logs/',
          '',
          '# Agent workspaces',
          'workspaces/',
        ].join('\n') + '\n',
      );

      // Write workspace-exclude
      await atomicWrite(
        paths.workspaceExcludePath,
        [
          '.orchestry',
          'node_modules',
          '.env',
          '.env.*',
          'dist',
          'build',
          '.next',
          '__pycache__',
          '*.pyc',
          '.venv',
        ].join('\n') + '\n',
      );

      // Write default template
      await atomicWrite(paths.defaultTemplatePath(), DEFAULT_PROMPT_TEMPLATE);

      // Output
      console.log();
      printSuccess('initialized');
      console.log();
      console.log(`  Created ${dim('.orchestry/')}`);
      console.log(`  ${dim('├──')} config.yml`);
      console.log(`  ${dim('├──')} tasks/`);
      console.log(`  ${dim('├──')} agents/`);
      console.log(`  ${dim('├──')} templates/default.md`);
      console.log(`  ${dim('└──')} .gitignore`);
      console.log();
      console.log(`  Next: ${dim('orch agent add <name> --adapter claude')}`);
      console.log();
    });
}
