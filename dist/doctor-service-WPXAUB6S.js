import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

// src/application/doctor-service.ts
var execFileAsync = promisify(execFile);
var DoctorService = class {
  constructor(adapterRegistry, processManager, projectRoot) {
    this.adapterRegistry = adapterRegistry;
    this.processManager = processManager;
    this.cwd = projectRoot ?? process.cwd();
  }
  adapterRegistry;
  processManager;
  cwd;
  async runAll() {
    const checks = [];
    const adapters = this.adapterRegistry.list();
    let adaptersReady = 0;
    for (const adapter of adapters) {
      const result = await adapter.test();
      if (result.ok) {
        adaptersReady++;
        checks.push({
          name: adapter.kind,
          status: "ok",
          detail: result.version
        });
      } else {
        checks.push({
          name: adapter.kind,
          status: "fail",
          detail: result.error
        });
      }
    }
    checks.push(await this.checkCommand("git", ["--version"], "git"));
    checks.push(await this.checkGitRepo());
    checks.push(await this.checkGitignore());
    checks.push(await this.checkCommand("node", ["--version"], "node"));
    return {
      checks,
      adaptersReady,
      adaptersTotal: adapters.length
    };
  }
  async checkCommand(command, args, name) {
    try {
      const { stdout } = await execFileAsync(command, args);
      return { name, status: "ok", detail: stdout.trim() };
    } catch {
      return { name, status: "fail", detail: `${command}: command not found` };
    }
  }
  async checkGitignore() {
    const gitignorePath = path.join(this.cwd, ".gitignore");
    try {
      const content = await fs.readFile(gitignorePath, "utf-8");
      const hasEntry = content.split("\n").some((line) => line.trim() === ".orchestry");
      if (hasEntry) {
        return { name: ".gitignore", status: "ok", detail: ".orchestry is excluded" };
      }
      return {
        name: ".gitignore",
        status: "fail",
        detail: ".orchestry not in .gitignore \u2014 worktrees will copy state recursively. Run: orch init"
      };
    } catch {
      return {
        name: ".gitignore",
        status: "fail",
        detail: "no .gitignore found \u2014 .orchestry may be committed to git. Run: orch init"
      };
    }
  }
  async checkGitRepo() {
    try {
      await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: this.cwd });
      return { name: "git repo", status: "ok", detail: "git repository detected" };
    } catch {
      return {
        name: "git repo",
        status: "fail",
        detail: "not a git repository \u2014 worktree/isolated modes will fail. Run: git init"
      };
    }
  }
};

export { DoctorService };
//# sourceMappingURL=doctor-service-WPXAUB6S.js.map
//# sourceMappingURL=doctor-service-WPXAUB6S.js.map