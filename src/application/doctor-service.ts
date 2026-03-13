/**
 * Doctor service — diagnostics and health checks.
 *
 * Checks adapter availability, system dependencies, project state.
 */

import type { AdapterRegistry } from '../infrastructure/adapters/registry.js';
import type { IProcessManager } from '../infrastructure/process/process-manager.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'fail' | 'skip';
  detail?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  adaptersReady: number;
  adaptersTotal: number;
}

export class DoctorService {
  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly processManager: IProcessManager,
    private readonly projectRoot?: string,
  ) {}

  async runAll(): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];

    // Check adapters
    const adapters = this.adapterRegistry.list();
    let adaptersReady = 0;

    for (const adapter of adapters) {
      const result = await adapter.test();
      if (result.ok) {
        adaptersReady++;
        checks.push({
          name: adapter.kind,
          status: 'ok',
          detail: result.version,
        });
      } else {
        checks.push({
          name: adapter.kind,
          status: 'fail',
          detail: result.error,
        });
      }
    }

    // Check git
    checks.push(await this.checkCommand('git', ['--version'], 'git'));

    // Check git repository (required for worktree/isolated workspace modes)
    checks.push(await this.checkGitRepo());

    // Check .orchestry in root .gitignore (prevents recursive worktrees)
    checks.push(await this.checkGitignore());

    // Check node
    checks.push(await this.checkCommand('node', ['--version'], 'node'));

    return {
      checks,
      adaptersReady,
      adaptersTotal: adapters.length,
    };
  }

  private async checkCommand(
    command: string,
    args: string[],
    name: string,
  ): Promise<DoctorCheck> {
    try {
      const { stdout } = await execFileAsync(command, args);
      return { name, status: 'ok', detail: stdout.trim() };
    } catch {
      return { name, status: 'fail', detail: `${command}: command not found` };
    }
  }

  private async checkGitignore(): Promise<DoctorCheck> {
    const cwd = this.projectRoot ?? process.cwd();
    const gitignorePath = path.join(cwd, '.gitignore');
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      const hasEntry = content.split('\n').some((line) => line.trim() === '.orchestry');
      if (hasEntry) {
        return { name: '.gitignore', status: 'ok', detail: '.orchestry is excluded' };
      }
      return {
        name: '.gitignore',
        status: 'fail',
        detail: '.orchestry not in .gitignore — worktrees will copy state recursively. Run: orch init',
      };
    } catch {
      return {
        name: '.gitignore',
        status: 'fail',
        detail: 'no .gitignore found — .orchestry may be committed to git. Run: orch init',
      };
    }
  }

  private async checkGitRepo(): Promise<DoctorCheck> {
    const cwd = this.projectRoot ?? process.cwd();
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
      return { name: 'git repo', status: 'ok', detail: 'git repository detected' };
    } catch {
      return {
        name: 'git repo',
        status: 'fail',
        detail: 'not a git repository — worktree/isolated modes will fail. Run: git init',
      };
    }
  }
}
