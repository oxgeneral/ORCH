import { sanitizeId, validateWorkspacePath } from './chunk-ZDGESOGD.js';
import { ensureDir } from './chunk-MGX3XJQL.js';
import './chunk-RQZGDMFG.js';
import { WorkspaceError } from './chunk-IESAV453.js';
import path from 'path';
import fs from 'fs/promises';

// src/infrastructure/workspace/merge-strategy.ts
var MergeStrategy = class {
  constructor(projectRoot, processManager) {
    this.projectRoot = projectRoot;
    this.processManager = processManager;
  }
  /**
   * Merge a branch into the current branch with --no-ff.
   * On conflict, aborts the merge and returns conflict info.
   */
  async mergeBack(branch) {
    return new Promise((resolve) => {
      const { process: proc } = this.processManager.spawn(
        "git",
        ["merge", "--no-ff", branch, "-m", `Merge ${branch}`],
        { cwd: this.projectRoot }
      );
      let output = "";
      const maxOutputLen = 2e3;
      const appendOutput = (chunk) => {
        if (output.length < maxOutputLen) output += chunk.toString();
      };
      proc.stdout?.on("data", appendOutput);
      proc.stderr?.on("data", appendOutput);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve({ success: true });
          return;
        }
        const trimmedOutput = output.slice(0, 1e3);
        const isConflict = trimmedOutput.includes("CONFLICT") || trimmedOutput.includes("Merge conflict");
        if (!isConflict) {
          resolve({ success: false, conflictInfo: trimmedOutput });
          return;
        }
        try {
          const { process: abortProc } = this.processManager.spawn(
            "git",
            ["merge", "--abort"],
            { cwd: this.projectRoot }
          );
          abortProc.on("close", () => {
            resolve({ success: false, conflictInfo: trimmedOutput });
          });
          abortProc.on("error", () => {
            resolve({ success: false, conflictInfo: trimmedOutput });
          });
        } catch {
          resolve({ success: false, conflictInfo: trimmedOutput });
        }
      });
      proc.on("error", (err) => {
        resolve({ success: false, conflictInfo: err.message });
      });
    });
  }
};

// src/infrastructure/workspace/workspace-manager.ts
var WorkspaceManager = class {
  constructor(projectRoot, orchestryDir, processManager) {
    this.projectRoot = projectRoot;
    this.orchestryDir = orchestryDir;
    this.processManager = processManager;
    this.mergeStrategy = new MergeStrategy(projectRoot, processManager);
  }
  mergeStrategy;
  gitRepoChecked = false;
  isGitRepo = false;
  async prepare(task, agent, config) {
    const mode = this.resolveMode(task, agent, config);
    if (mode !== "shared") {
      await this.requireGitRepo(mode);
    }
    switch (mode) {
      case "shared":
        return { path: this.projectRoot };
      case "worktree":
        return this.prepareWorktree(task);
      case "isolated":
        return { path: await this.prepareIsolated(task) };
      default:
        return { path: this.projectRoot };
    }
  }
  async requireGitRepo(mode) {
    if (!this.gitRepoChecked) {
      const code = await this.spawnAndWait("git", ["rev-parse", "--is-inside-work-tree"]);
      this.isGitRepo = code === 0;
      if (this.isGitRepo) this.gitRepoChecked = true;
    }
    if (!this.isGitRepo) {
      throw new WorkspaceError(
        `workspace_mode "${mode}" requires a git repository`,
        'Run: git init && git add -A && git commit -m "Initial commit"\n         Or set workspace_mode: shared in .orchestry/config.yml'
      );
    }
  }
  async mergeBack(branch) {
    return this.mergeStrategy.mergeBack(branch);
  }
  async cleanup(taskId, branch) {
    const workspacePath = path.join(this.orchestryDir, "workspaces", sanitizeId(taskId));
    await this.spawnAndWait("git", ["worktree", "remove", "--force", workspacePath]);
    const branchDeletion = branch ? this.spawnAndWait("git", ["branch", "-D", branch]).then(() => {
    }) : Promise.resolve();
    const dirRemoval = fs.rm(workspacePath, { recursive: true, force: true }).catch(() => {
    });
    await Promise.all([branchDeletion, dirRemoval]);
  }
  validate(workspacePath, projectRoot) {
    validateWorkspacePath(workspacePath, projectRoot);
  }
  /**
   * Get files changed on a worktree branch relative to its merge-base.
   * Uses `git merge-base` to find the fork point dynamically (no hardcoded branch name).
   */
  async getChangedFiles(branch) {
    try {
      const { stdout: baseStdout } = await this.spawnAndCapture(
        "git",
        ["merge-base", "HEAD", branch]
      );
      const mergeBase = baseStdout.trim();
      if (!mergeBase) return [];
      const { stdout: diffStdout, code } = await this.spawnAndCapture(
        "git",
        ["diff", "--name-only", `${mergeBase}...${branch}`]
      );
      if (code !== 0 || !diffStdout.trim()) return [];
      return diffStdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
  resolveMode(task, agent, config) {
    return task.workspace_mode ?? agent.config.workspace_mode ?? config.defaults.agent.workspace_mode ?? "worktree";
  }
  async prepareWorktree(task) {
    const workspacePath = path.join(
      this.orchestryDir,
      "workspaces",
      sanitizeId(task.id)
    );
    await ensureDir(path.dirname(workspacePath));
    const titleSlug = sanitizeTitle(task.title) || sanitizeId(task.id);
    const branchName = `orchestry/${sanitizeId(task.id)}/${titleSlug}`;
    try {
      await fs.access(workspacePath);
      return { path: workspacePath, branch: branchName };
    } catch {
    }
    const createResult = await this.spawnAndWait(
      "git",
      ["worktree", "add", workspacePath, "-b", branchName]
    );
    if (createResult !== 0) {
      await this.spawnAndWait("git", ["worktree", "prune"]);
      const reuseResult = await this.spawnAndWait(
        "git",
        ["worktree", "add", workspacePath, branchName]
      );
      if (reuseResult !== 0) {
        throw new WorkspaceError(
          `git worktree add failed with code ${reuseResult}`,
          "Run: git worktree prune && git branch | grep orchestry | xargs -r git branch -D"
        );
      }
    }
    const worktreeOrchestry = path.join(workspacePath, ".orchestry");
    await fs.rm(worktreeOrchestry, { recursive: true, force: true }).catch(() => {
    });
    return { path: workspacePath, branch: branchName };
  }
  /** Spawn a command and return exit code (non-throwing). */
  async spawnAndWait(cmd, args) {
    try {
      const { process: proc } = this.processManager.spawn(cmd, args, { cwd: this.projectRoot });
      return new Promise((resolve) => {
        proc.on("close", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
      });
    } catch {
      return 1;
    }
  }
  /** Spawn a command and capture stdout + exit code. */
  async spawnAndCapture(cmd, args) {
    try {
      const { process: proc } = this.processManager.spawn(cmd, args, { cwd: this.projectRoot });
      let stdout = "";
      proc.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      const code = await new Promise((resolve) => {
        proc.on("close", (c) => resolve(c ?? 1));
        proc.on("error", () => resolve(1));
      });
      return { stdout, code };
    } catch {
      return { stdout: "", code: 1 };
    }
  }
  async prepareIsolated(task) {
    const workspacePath = path.join(
      this.orchestryDir,
      "workspaces",
      sanitizeId(task.id)
    );
    await ensureDir(path.dirname(workspacePath));
    try {
      const cloneResult = await this.spawnAndWait(
        "git",
        ["clone", "--local", "--no-hardlinks", this.projectRoot, workspacePath]
      );
      if (cloneResult !== 0) throw new Error("git clone failed");
    } catch {
      const excludeFile = path.join(this.orchestryDir, "workspace-exclude");
      const args = ["-a", `--exclude-from=${excludeFile}`, "./", `${workspacePath}/`];
      const rsyncResult = await this.spawnAndWait("rsync", args);
      if (rsyncResult !== 0) {
        throw new Error(`rsync failed with code ${rsyncResult}`);
      }
    }
    const clonedOrchestry = path.join(workspacePath, ".orchestry");
    await fs.rm(clonedOrchestry, { recursive: true, force: true }).catch(() => {
    });
    return workspacePath;
  }
};
function sanitizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export { WorkspaceManager };
//# sourceMappingURL=workspace-manager-JJAXIH6T.js.map
//# sourceMappingURL=workspace-manager-JJAXIH6T.js.map