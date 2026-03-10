/**
 * Doctor service — diagnostics and health checks.
 *
 * Checks adapter availability, system dependencies, project state.
 */

import type { AdapterRegistry } from '../infrastructure/adapters/registry.js';
import type { IProcessManager } from '../infrastructure/process/process-manager.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
}
